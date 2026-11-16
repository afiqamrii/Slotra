import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type VenueSceneResource = {
  id: string;
  name: string;
  sport?: string;
  available: boolean | null;
};

export type VenueScene = {
  updateResources: (resources: VenueSceneResource[], selectedId?: string) => void;
  resetView: () => void;
  rotate: (direction: number) => void;
  zoom: (direction: number) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
};

type SceneOptions = {
  resources: VenueSceneResource[];
  onSelect: (id: string) => void;
  onError: () => void;
};

type Assets = {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
};

type Court = {
  surface: THREE.MeshStandardMaterial;
  marker: THREE.MeshStandardMaterial;
  ring: THREE.Group;
};

type Coordinates = [number, number, number];

function makeAssets(): Assets {
  return { geometries: new Set(), materials: new Set(), textures: new Set() };
}

function disposeAssets(assets: Assets) {
  assets.geometries.forEach((asset) => asset.dispose());
  assets.materials.forEach((asset) => asset.dispose());
  assets.textures.forEach((asset) => asset.dispose());
  assets.geometries.clear();
  assets.materials.clear();
  assets.textures.clear();
}

/**
 * An illustrative arrangement of the supplied spaces, never an exact floor plan.
 * Availability is supplied by the caller; this module does not decide bookability.
 * Load in the browser only, and retain equivalent HTML controls outside the canvas.
 */
export function createVenueScene(container: HTMLElement, options: SceneOptions): VenueScene {
  const sharedAssets = makeAssets();
  const worldAssets = makeAssets();
  let assetScope = sharedAssets;
  let renderer: THREE.WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined;
  let key: THREE.DirectionalLight | undefined;
  let disposed = false;
  let failed = false;
  let active = true;
  let frame = 0;
  let fitFactor = 1;
  let sceneScale = 1;
  let signature = "";
  let pointerStart: { id: number; x: number; y: number } | null = null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f6f1);
  const world = new THREE.Group();
  scene.add(world);
  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 2000);
  const courts = new Map<string, Court>();
  const pickable = new Map<THREE.Object3D, string>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function material(values: THREE.MeshStandardMaterialParameters) {
    const result = new THREE.MeshStandardMaterial(values);
    assetScope.materials.add(result);
    return result;
  }

  function basic(values: THREE.MeshBasicMaterialParameters) {
    const result = new THREE.MeshBasicMaterial(values);
    assetScope.materials.add(result);
    return result;
  }

  function texture(draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, width = 256, height = width) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Venue textures are unavailable.");
    draw(context, width, height);
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = Math.min(4, renderer?.capabilities.getMaxAnisotropy() ?? 1);
    assetScope.textures.add(result);
    return result;
  }

  function mesh(shape: THREE.BufferGeometry, surface: THREE.Material, parent: THREE.Object3D = world, x = 0, y = 0, z = 0, shadow = true) {
    assetScope.geometries.add(shape);
    const result = new THREE.Mesh(shape, surface);
    result.position.set(x, y, z);
    result.castShadow = shadow;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  function box(width: number, height: number, depth: number, surface: THREE.Material, parent: THREE.Object3D = world, x = 0, y = 0, z = 0, shadow = true) {
    return mesh(new THREE.BoxGeometry(width, height, depth), surface, parent, x, y, z, shadow);
  }

  function rod(from: Coordinates, to: Coordinates, radius: number, surface: THREE.Material, parent: THREE.Object3D = world) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const result = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), surface, parent);
    result.position.copy(a.add(b).multiplyScalar(0.5));
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return result;
  }

  function floorPlane(width: number, depth: number, surface: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) {
    const result = mesh(new THREE.PlaneGeometry(width, depth), surface, parent, x, y, z, false);
    result.rotation.x = -Math.PI / 2;
    return result;
  }

  function label(value: string) {
    const map = texture((context, width, height) => {
      context.font = "600 48px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#eef3e6";
      // Canvas text is inert. Long real names are fitted, never treated as HTML.
      context.fillText(value, width / 2, height / 2, width - 24);
    }, 512, 96);
    return basic({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  }

  function fail() {
    if (disposed || failed) return;
    failed = true;
    active = false;
    dispose();
    options.onError();
  }

  function render() {
    frame = 0;
    if (disposed || !active || failed || document.hidden || !container.clientWidth || !container.clientHeight) return;
    try { renderer?.render(scene, camera); } catch { fail(); }
  }

  function invalidate() {
    if (!disposed && active && !failed && !frame && !document.hidden) frame = requestAnimationFrame(render);
  }

  function resize() {
    if (disposed || failed || !renderer || !controls) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    const nextFitFactor = Math.max(1, 1.35 / aspect);
    if (Math.abs(nextFitFactor - fitFactor) > 0.0001) {
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(nextFitFactor / fitFactor);
      camera.position.copy(controls.target).add(offset);
      fitFactor = nextFitFactor;
    }
    controls.minDistance = 34 * sceneScale * fitFactor;
    controls.maxDistance = 105 * sceneScale * fitFactor;
    controls.update();
    renderer.setSize(width, height, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    invalidate();
  }

  function resetView() {
    if (!controls || disposed) return;
    controls.target.set(0, 0.8, 0);
    controls.minDistance = 34 * sceneScale * fitFactor;
    controls.maxDistance = 105 * sceneScale * fitFactor;
    camera.position.copy(controls.target).add(new THREE.Vector3(31, 30.2, 36).multiplyScalar(sceneScale * fitFactor));
    controls.update();
    invalidate();
  }

  function rotate(direction: number) {
    if (!controls || !active || disposed) return;
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta = THREE.MathUtils.clamp(spherical.theta + Math.sign(direction) * Math.PI / 12, controls.minAzimuthAngle, controls.maxAzimuthAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    controls.update();
    invalidate();
  }

  function zoom(direction: number) {
    if (!controls || !active || disposed) return;
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * (direction > 0 ? 0.84 : 1.19), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setLength(distance));
    controls.update();
    invalidate();
  }

  function pointerDown(event: PointerEvent) {
    if (!active || (event.button !== 0 && event.pointerType !== "touch")) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (renderer && event.pointerType === "mouse") renderer.domElement.style.cursor = "grabbing";
  }

  function pointerCancel() {
    pointerStart = null;
    if (renderer) renderer.domElement.style.cursor = "grab";
  }

  function pointerUp(event: PointerEvent) {
    if (renderer) renderer.domElement.style.cursor = "grab";
    if (!renderer || !active || disposed || !pointerStart || event.pointerId !== pointerStart.id) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (distance > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...pickable.keys()], false)[0];
    const id = hit ? pickable.get(hit.object) : undefined;
    if (id !== undefined && courts.has(id)) options.onSelect(id);
  }

  function contextLost(event: Event) {
    event.preventDefault();
    fail();
  }

  function visibility() {
    if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
    else invalidate();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("resize", resize);
    controls?.removeEventListener("change", invalidate);
    controls?.dispose();
    renderer?.domElement.removeEventListener("pointerdown", pointerDown);
    renderer?.domElement.removeEventListener("pointerup", pointerUp);
    renderer?.domElement.removeEventListener("pointercancel", pointerCancel);
    renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
    document.removeEventListener("visibilitychange", visibility);
    disposeAssets(worldAssets);
    disposeAssets(sharedAssets);
    key?.shadow.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    courts.clear();
    pickable.clear();
    world.clear();
    scene.clear();
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0xf5f6f1);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;";
    container.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = 0.3;
    controls.maxPolarAngle = 1.2;
    controls.minAzimuthAngle = -0.42;
    controls.maxAzimuthAngle = 1.48;
    controls.rotateSpeed = 0.55;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE };
    controls.touches = {}; // Preserve page scrolling; explicit buttons rotate on touch devices.
    renderer.domElement.style.touchAction = "pan-y";

    let seed = 1807;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const rubber = texture((context, width, height) => {
      context.fillStyle = "#d7d9d5";
      context.fillRect(0, 0, width, height);
      for (let index = 0; index < 14000; index++) {
        const value = 195 + Math.floor(random() * 50);
        context.fillStyle = `rgba(${value},${value},${value},.38)`;
        context.fillRect(random() * width, random() * height, 1, 1);
      }
    });
    rubber.wrapS = rubber.wrapT = THREE.RepeatWrapping;
    rubber.repeat.set(4, 8);
    const timber = texture((context, width, height) => {
      context.fillStyle = "#ac9d85";
      context.fillRect(0, 0, width, height);
      for (let row = 0; row < 16; row++) {
        const value = 133 + Math.floor(random() * 30);
        context.fillStyle = `rgb(${value + 30},${value + 18},${value})`;
        context.fillRect(0, row * 32, width, 31);
        context.fillStyle = "#746f6066";
        context.fillRect(0, row * 32, width, 1);
        for (let x = row % 2 ? 90 : 0; x < width; x += 175) context.fillRect(x, row * 32, 1, 31);
        for (let line = 0; line < 16; line++) {
          context.strokeStyle = `rgba(88,72,53,${0.025 + random() * 0.06})`;
          context.beginPath();
          const y = row * 32 + random() * 30;
          context.moveTo(0, y);
          context.bezierCurveTo(width * 0.3, y + 2, width * 0.7, y - 2, width, y + 1);
          context.stroke();
        }
      }
    }, 512);
    timber.wrapS = timber.wrapT = THREE.RepeatWrapping;
    timber.repeat.set(2, 2.5);
    const netTexture = texture((context, width, height) => {
      context.strokeStyle = "#24352e";
      context.lineWidth = 1.5;
      for (let x = 0; x <= width; x += 16) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
      for (let y = 0; y <= height; y += 16) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
    }, 64);
    netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping;
    netTexture.repeat.set(14, 1.5);

    const concrete = material({ color: 0xb7bdb3, roughness: 0.92 });
    const deckEdge = material({ color: 0x6c796e, roughness: 0.87 });
    const aisle = material({ color: 0xf2e8cf, map: timber, roughness: 0.78 });
    const greenWall = material({ color: 0x345c50, roughness: 0.85 });
    const upperWall = material({ color: 0xd9dfd7, roughness: 0.93 });
    const trim = material({ color: 0x74867c, metalness: 0.4, roughness: 0.48 });
    const steel = material({ color: 0x394f48, metalness: 0.65, roughness: 0.35 });
    const white = material({ color: 0xf4f2df, roughness: 0.68 });
    const black = material({ color: 0x273933, roughness: 0.85 });
    const wood = material({ color: 0xa88b62, map: timber, roughness: 0.7 });
    const glass = material({ color: 0xdceae2, roughness: 0.28, metalness: 0.1, emissive: 0xb5cfc0, emissiveIntensity: 0.12 });
    const paint = material({ color: 0xf8f7e5, roughness: 0.95 });
    const matEdge = material({ color: 0x294e41, roughness: 0.9 });
    const netMaterial = material({ color: 0xc8d0c6, map: netTexture, transparent: true, alphaTest: 0.15, side: THREE.DoubleSide, roughness: 0.95, depthWrite: false });
    const selectedMaterial = material({ color: 0xd4df8a, emissive: 0xaabf48, emissiveIntensity: 0.22, roughness: 0.8 });
    const lightMaterial = material({ color: 0xfffbe5, emissive: 0xfff4cf, emissiveIntensity: 1.7 });
    const groundMaterial = material({ color: 0xf1f3ec, roughness: 1 });

    scene.add(new THREE.HemisphereLight(0xf2f5eb, 0x899d83, 2.1));
    key = new THREE.DirectionalLight(0xfff4db, 3.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.normalBias = 0.025;
    key.shadow.bias = -0.00008;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd6e9ed, 1.1);
    fill.position.set(18, 14, -16);
    scene.add(fill);
    assetScope = worldAssets;

    function bench(x: number, z: number) {
      const group = new THREE.Group();
      group.position.set(x, 0.2, z);
      world.add(group);
      for (const offset of [-0.2, 0, 0.2]) box(2.5, 0.08, 0.17, wood, group, 0, 0.48, offset);
      for (const leg of [-0.95, 0.95]) {
        box(0.08, 0.48, 0.48, steel, group, leg, 0.24, 0);
        box(0.08, 0.65, 0.08, steel, group, leg, 0.68, -0.24);
      }
      box(2.5, 0.16, 0.07, wood, group, 0, 0.82, -0.24);
      box(2.5, 0.16, 0.07, wood, group, 0, 1.02, -0.24);
    }

    function makeCourt(resource: VenueSceneResource, x: number, z: number) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      world.add(group);
      const surface = material({ color: 0x39846b, map: rubber, bumpMap: rubber, bumpScale: 0.018, roughness: 0.88 });
      box(7.36, 0.035, 14.48, matEdge, group, 0, 0.19, 0, false);
      const playingSurface = box(7.3, 0.025, 14.42, surface, group, 0, 0.219, 0, false);
      pickable.set(playingSurface, resource.id);
      const horizontal = (at: number, width = 6.1) => box(width, 0.005, 0.04, paint, group, 0, 0.235, at, false);
      const vertical = (at: number, length = 13.4, center = 0) => box(0.04, 0.005, length, paint, group, at, 0.235, center, false);
      horizontal(-6.7); horizontal(6.7); vertical(-3.05); vertical(3.05);
      if (resource.sport?.trim().toLowerCase() === "badminton") {
        vertical(-2.59); vertical(2.59);
        for (const side of [-1, 1]) { horizontal(side * 5.94); horizontal(side * 1.98); vertical(0, 4.72, side * 4.34); }
        for (const side of [-1, 1]) {
          box(0.34, 0.1, 0.55, black, group, side * 3.2, 0.29, 0);
          mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.55, 12), steel, group, side * 3.2, 1.01, 0);
          mesh(new THREE.SphereGeometry(0.06, 10, 8), white, group, side * 3.2, 1.8, 0);
          rod([side * 3.2, 0.35, 0.21], [side * 3.2, 0.9, 0], 0.026, trim, group);
        }
        const net = mesh(new THREE.PlaneGeometry(6.36, 0.76, 32, 1), netMaterial, group, 0, 1.37, 0);
        const positions = net.geometry.getAttribute("position");
        for (let index = 0; index < positions.count; index++) positions.setY(index, positions.getY(index) - 0.035 * (1 - Math.pow(positions.getX(index) / 3.18, 2)));
        positions.needsUpdate = true;
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-3.2, 1.77, 0), new THREE.Vector3(0, 1.735, 0), new THREE.Vector3(3.2, 1.77, 0)]);
        mesh(new THREE.TubeGeometry(curve, 28, 0.023, 5, false), white, group);
        rod([-3.2, 0.99, 0], [3.2, 0.99, 0], 0.009, steel, group);
      }
      floorPlane(5.6, 0.95, label(resource.name), group, 0, 0.245, 5.8);
      const ring = new THREE.Group();
      ring.visible = false;
      group.add(ring);
      box(7.48, 0.012, 0.06, selectedMaterial, ring, 0, 0.26, -7.3, false);
      box(7.48, 0.012, 0.06, selectedMaterial, ring, 0, 0.26, 7.3, false);
      box(0.06, 0.012, 14.6, selectedMaterial, ring, -3.74, 0.26, 0, false);
      box(0.06, 0.012, 14.6, selectedMaterial, ring, 3.74, 0.26, 0, false);
      const marker = material({ color: 0x78ad85, roughness: 0.55, emissive: 0x2e5b40, emissiveIntensity: 0.12 });
      box(0.8, 0.06, 0.16, marker, group, 2.6, 0.25, 7.03, false);
      courts.set(resource.id, { surface, marker, ring });
    }

    function buildWorld(resources: VenueSceneResource[]) {
      world.clear();
      courts.clear();
      pickable.clear();
      disposeAssets(worldAssets);
      const columns = Math.max(1, Math.min(4, resources.length, Math.ceil(Math.sqrt(resources.length * 1.5))));
      const rows = Math.max(1, Math.ceil(resources.length / columns));
      const width = columns * 8.6 + 2.8;
      const depth = rows * 16 + 3;
      const left = -width / 2;
      const back = -depth / 2;
      sceneScale = Math.max(0.65, width / 28.6, depth / 35);
      camera.far = Math.max(2000, sceneScale * 500);
      camera.updateProjectionMatrix();
      if (key) {
        key.position.set(-9 * sceneScale, 26 * sceneScale, 14 * sceneScale);
        Object.assign(key.shadow.camera, { left: -width, right: width, top: depth, bottom: -depth, near: 0.5, far: 100 * sceneScale });
        key.shadow.camera.updateProjectionMatrix();
      }
      floorPlane(2000 * sceneScale, 2000 * sceneScale, groundMaterial, world, 0, -0.42, 0);
      box(width + 0.2, 0.42, depth + 0.2, deckEdge, world, 0, -0.15, 0);
      box(width, 0.12, depth, aisle, world, 0, 0.12, 0);
      box(width, 0.08, 0.14, concrete, world, 0, 0.22, depth / 2);
      box(0.14, 0.08, depth, concrete, world, width / 2, 0.22, 0);
      box(width, 2.4, 0.25, greenWall, world, 0, 1.35, back);
      box(0.25, 2.4, depth, greenWall, world, left, 1.35, 0);
      box(width, 2.2, 0.22, upperWall, world, 0, 3.65, back);
      box(0.22, 2.2, depth, upperWall, world, left, 3.65, 0);
      box(width, 0.14, 0.36, trim, world, 0, 2.55, back + 0.05);
      box(0.36, 0.14, depth, trim, world, left + 0.05, 2.55, 0);
      box(width, 0.26, 0.3, steel, world, 0, 5.2, back + 0.2);
      box(0.3, 0.26, depth, steel, world, left + 0.2, 5.2, 0);
      for (let column = 0; column < columns; column++) {
        const x = (column - (columns - 1) / 2) * 8.6;
        box(0.16, 5.1, 0.28, steel, world, x, 2.7, back + 0.3);
        box(6.6, 1.35, 0.07, glass, world, x, 3.8, back + 0.18, false);
        box(6.6, 0.045, 0.11, trim, world, x, 3.8, back + 0.27);
        rod([x, 5.2, back + 0.25], [x, 4.7, back + 1.4], 0.035, steel);
        box(2.7, 0.13, 0.35, trim, world, x, 4.68, back + 1.4);
        box(2.5, 0.035, 0.27, lightMaterial, world, x, 4.6, back + 1.4, false);
        bench(x, depth / 2 - 0.6);
      }
      for (let row = 0; row < rows; row++) {
        const z = (row - (rows - 1) / 2) * 16;
        box(0.28, 5.1, 0.16, steel, world, left + 0.3, 2.7, z);
        box(0.07, 1.35, 11.8, glass, world, left + 0.18, 3.8, z, false);
        box(0.11, 1.35, 0.06, trim, world, left + 0.27, 3.8, z);
      }
      for (const [index, resource] of resources.entries()) {
        makeCourt(resource, (index % columns - (columns - 1) / 2) * 8.6, (Math.floor(index / columns) - (rows - 1) / 2) * 16);
      }
      resetView();
    }

    function updateResources(resources: VenueSceneResource[], selectedId?: string) {
      if (disposed || failed) return;
      try {
        const nextSignature = JSON.stringify(resources.map(({ id, name, sport }) => [id, name, sport]));
        if (nextSignature !== signature) { buildWorld(resources); signature = nextSignature; }
        for (const resource of resources) {
          const court = courts.get(resource.id);
          if (!court) continue;
          court.surface.color.set(resource.available === true ? 0x39846b : resource.available === false ? 0x67796f : 0x668b7a);
          court.marker.color.set(resource.available === true ? 0x8cbe87 : 0x9b9d90);
          court.marker.emissiveIntensity = resource.available === true ? 0.12 : 0;
          court.ring.visible = resource.id === selectedId;
        }
        invalidate();
      } catch { fail(); }
    }

    controls.addEventListener("change", invalidate);
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerCancel);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", visibility);
    if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(resize); observer.observe(container); }
    else window.addEventListener("resize", resize);
    updateResources(options.resources);
    resize();
    return {
      updateResources, resetView, rotate, zoom, dispose,
      setActive(value) {
        if (disposed || failed) return;
        active = value;
        pointerCancel();
        if (controls) controls.enabled = active;
        if (!active && frame) { cancelAnimationFrame(frame); frame = 0; }
        if (active) { resize(); invalidate(); }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
