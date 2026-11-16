import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** A local, illustrative hall. Court state comes from the surrounding preview. */
export function createVenueScene(container, { onSelect = () => {}, onError = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0xf5f6f1);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f6f1);
  const camera = new THREE.PerspectiveCamera(39, 1, .1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .8, 0);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.enableZoom = false; // Wheel/touch scrolling belongs to the page; UI buttons handle zoom.
  controls.minDistance = 34;
  controls.maxDistance = 105;
  controls.minPolarAngle = .3;
  controls.maxPolarAngle = 1.2;
  controls.minAzimuthAngle = -.42;
  controls.maxAzimuthAngle = 1.48;
  controls.rotateSpeed = .55;
  controls.mouseButtons.RIGHT = undefined;
  controls.mouseButtons.MIDDLE = undefined;
  controls.touches.ONE = undefined;
  controls.touches.TWO = undefined;
  renderer.domElement.style.touchAction = 'pan-y';

  const textures = new Set();
  const materials = new Set();
  const geometries = new Set();
  let disposed = false, active = true, frame = 0, pointerStart = null, fitFactor = 1;
  const courts = new Map();
  const pickable = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function geometry(value) { geometries.add(value); return value; }
  function material(values) {
    const result = new THREE.MeshStandardMaterial(values);
    materials.add(result);
    return result;
  }
  function basic(values) {
    const result = new THREE.MeshBasicMaterial(values);
    materials.add(result);
    return result;
  }
  function texture(draw, width = 256, height = width) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot create the venue textures.');
    draw(context, width, height);
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.add(result);
    return result;
  }
  let seed = 1807;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rubber = texture((ctx, w, h) => {
    ctx.fillStyle = '#d7d9d5'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      const value = 195 + Math.floor(random() * 50);
      ctx.fillStyle = `rgba(${value},${value},${value},.38)`;
      ctx.fillRect(random() * w, random() * h, 1, 1);
    }
  });
  rubber.wrapS = rubber.wrapT = THREE.RepeatWrapping;
  rubber.repeat.set(4, 8);
  const timber = texture((ctx, w, h) => {
    ctx.fillStyle = '#ac9d85'; ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 16; row++) {
      const value = 133 + Math.floor(random() * 30);
      ctx.fillStyle = `rgb(${value + 30},${value + 18},${value})`;
      ctx.fillRect(0, row * 32, w, 31);
      ctx.fillStyle = '#746f6066'; ctx.fillRect(0, row * 32, w, 1);
      const offset = row % 2 ? 90 : 0;
      for (let x = offset; x < w; x += 175) ctx.fillRect(x, row * 32, 1, 31);
      for (let line = 0; line < 16; line++) {
        ctx.strokeStyle = `rgba(88,72,53,${.025 + random() * .06})`;
        ctx.beginPath();
        const y = row * 32 + random() * 30;
        ctx.moveTo(0, y); ctx.bezierCurveTo(w * .3, y + 2, w * .7, y - 2, w, y + 1); ctx.stroke();
      }
    }
  }, 512);
  timber.wrapS = timber.wrapT = THREE.RepeatWrapping; timber.repeat.set(2, 2.5);
  const netTexture = texture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#24352e'; ctx.lineWidth = 1.5;
    for (let x = 0; x <= w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }, 64);
  netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping; netTexture.repeat.set(14, 1.5);
  const contactTexture = texture((ctx, w, h) => {
    const glow = ctx.createRadialGradient(w / 2, h / 2, w * .05, w / 2, h / 2, w / 2);
    glow.addColorStop(0, '#12251f66'); glow.addColorStop(.55, '#12251f20'); glow.addColorStop(1, '#12251f00');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  });

  const concrete = material({ color: 0xb7bdb3, roughness: .92 });
  const deckEdge = material({ color: 0x6c796e, roughness: .87 });
  const aisle = material({ color: 0xf2e8cf, map: timber, roughness: .78, metalness: 0 });
  const greenWall = material({ color: 0x345c50, roughness: .85 });
  const upperWall = material({ color: 0xd9dfd7, roughness: .93 });
  const trim = material({ color: 0x74867c, metalness: .4, roughness: .48 });
  const steel = material({ color: 0x394f48, metalness: .65, roughness: .35 });
  const white = material({ color: 0xf4f2df, roughness: .68 });
  const orange = material({ color: 0xda833c, roughness: .67 });
  const black = material({ color: 0x273933, roughness: .85 });
  const wood = material({ color: 0xa88b62, map: timber, roughness: .7 });
  const glass = material({ color: 0xdceae2, roughness: .28, metalness: .1, emissive: 0xb5cfc0, emissiveIntensity: .12 });
  const courtLine = material({ color: 0xf8f7e5, roughness: .95 });
  const netMaterial = material({ color: 0xc8d0c6, map: netTexture, transparent: true, alphaTest: .15, side: THREE.DoubleSide, roughness: .95, depthWrite: false });
  const contactMaterial = basic({ map: contactTexture, transparent: true, depthWrite: false, opacity: .7 });

  function mesh(shape, surface, parent = scene, x = 0, y = 0, z = 0, shadow = true) {
    const result = new THREE.Mesh(geometry(shape), surface);
    result.position.set(x, y, z); result.castShadow = shadow; result.receiveShadow = true;
    parent.add(result); return result;
  }
  function box(w, h, d, surface, parent = scene, x = 0, y = 0, z = 0, shadow = true) {
    return mesh(new THREE.BoxGeometry(w, h, d), surface, parent, x, y, z, shadow);
  }
  function rod(from, to, radius, surface, parent = scene) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const result = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), surface, parent);
    result.position.copy(a.add(b).multiplyScalar(.5));
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return result;
  }
  function floorPlane(w, d, surface, parent, x, y, z) {
    const result = mesh(new THREE.PlaneGeometry(w, d), surface, parent, x, y, z, false);
    result.rotation.x = -Math.PI / 2; return result;
  }
  function label(text, { width = 512, height = 128, color = '#e9eee4', background = null, font = '600 65px Arial', size = [4, 1] } = {}) {
    const map = texture((ctx, w, h) => {
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
      ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2 + 3);
    }, width, height);
    return { map, surface: basic({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide }), size };
  }

  scene.add(new THREE.HemisphereLight(0xf2f5eb, 0x899d83, 2.1));
  const key = new THREE.DirectionalLight(0xfff4db, 3.1);
  key.position.set(-9, 26, 14); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -24, right: 24, top: 25, bottom: -25, near: .5, far: 80 });
  key.shadow.normalBias = .025; key.shadow.bias = -.00008; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd6e9ed, 1.1); fill.position.set(18, 14, -16); scene.add(fill);
  const ground = material({ color: 0xf1f3ec, roughness: 1 });
  floorPlane(2000, 2000, ground, scene, 0, -.42, 0);
  box(28.8, .42, 35.2, deckEdge, scene, 0, -.15, 0);
  box(28.6, .12, 35, aisle, scene, 0, .12, 0);
  box(28.8, .08, .14, concrete, scene, 0, .22, 17.56);
  box(.14, .08, 35, concrete, scene, 14.36, .22, 0);

  // Open front and right side retain a clear view of every court.
  box(28.6, 2.4, .25, greenWall, scene, 0, 1.35, -17.35);
  box(.25, 2.4, 35, greenWall, scene, -14.35, 1.35, 0);
  box(28.6, 2.2, .22, upperWall, scene, 0, 3.65, -17.35);
  box(.22, 2.2, 35, upperWall, scene, -14.35, 3.65, 0);
  box(28.7, .14, .36, trim, scene, 0, 2.55, -17.3);
  box(.36, .14, 35, trim, scene, -14.3, 2.55, 0);
  for (const x of [-13.5, -8.6, -4.3, 0, 4.3, 8.6, 13.5]) {
    box(.16, 5.1, .28, steel, scene, x, 2.7, -17.05);
    if (Math.abs(x) < 13) {
      box(3.6, 1.35, .07, glass, scene, x, 3.8, -17.17, false);
      box(.045, 1.35, .11, trim, scene, x, 3.8, -17.08);
      box(3.65, .045, .11, trim, scene, x, 3.8, -17.08);
    }
  }
  for (const z of [-15.5, -7.8, 0, 7.8, 15.5]) {
    box(.28, 5.1, .16, steel, scene, -14.08, 2.7, z);
    box(.07, 1.35, 5.8, glass, scene, -14.17, 3.8, z, false);
    box(.11, 1.35, .06, trim, scene, -14.08, 3.8, z);
  }
  box(28.7, .26, .3, steel, scene, 0, 5.2, -17.12);
  box(.3, .26, 35, steel, scene, -14.12, 5.2, 0);
  for (const x of [-8.6, 0, 8.6]) {
    rod([x, 5.2, -17.1], [x, 4.7, -15.9], .035, steel);
    box(2.7, .13, .35, trim, scene, x, 4.68, -15.9);
    box(2.5, .035, .27, material({ color: 0xfffbe5, emissive: 0xfff4cf, emissiveIntensity: 1.7 }), scene, x, 4.6, -15.9, false);
  }
  const sign = label('SMASH ARENA', { color: '#f5f3df', font: '600 60px Arial', size: [6.2, 1.1] });
  mesh(new THREE.PlaneGeometry(...sign.size), sign.surface, scene, 0, 1.5, -17.19, false);
  const hallSign = label('HALL A', { font: '600 50px Arial', size: [1.4, .4] });
  mesh(new THREE.PlaneGeometry(...hallSign.size), hallSign.surface, scene, 11.6, 1.5, -17.18, false);

  function bench(x, z, angle = 0) {
    const group = new THREE.Group(); group.position.set(x, .2, z); group.rotation.y = angle; scene.add(group);
    for (const offset of [-.2, 0, .2]) box(2.5, .08, .17, wood, group, 0, .48, offset);
    for (const leg of [-.95, .95]) {
      box(.08, .48, .48, steel, group, leg, .24, 0);
      box(.08, .65, .08, steel, group, leg, .68, -.24);
    }
    box(2.5, .16, .07, wood, group, 0, .82, -.24);
    box(2.5, .16, .07, wood, group, 0, 1.02, -.24);
    box(.6, .3, .38, black, group, -.55, .67, .02);
    rod([-.75, .82, .02], [-.35, .82, .02], .025, trim, group);
  }
  bench(-11.8, 0, Math.PI / 2); bench(0, 16.5); bench(9.5, 16.5);
  // Equipment cart and water station add scale without covering the usable courts.
  box(.8, 1.2, .75, white, scene, -12.7, .8, 15.6);
  mesh(new THREE.CylinderGeometry(.21, .23, .45, 16), glass, scene, -12.7, 1.62, 15.6);
  box(.55, .1, .4, black, scene, -12.7, .92, 15.99);
  for (const wheel of [-.36, .36]) mesh(new THREE.CylinderGeometry(.14, .14, .08, 10), black, scene, 13.1 + wheel, .3, -15.7).rotation.z = Math.PI / 2;
  box(.95, .8, .65, trim, scene, 13.1, .78, -15.7);
  box(.82, .08, .52, black, scene, 13.1, 1.22, -15.7);
  const clockFace = texture((ctx, w, h) => {
    ctx.fillStyle = '#f4f3e6'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * .46, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#314e41'; ctx.lineWidth = 5;
    for (let mark = 0; mark < 12; mark++) { const a = mark / 6 * Math.PI; ctx.beginPath(); ctx.moveTo(w / 2 + Math.sin(a) * w * .38, h / 2 + Math.cos(a) * h * .38); ctx.lineTo(w / 2 + Math.sin(a) * w * .42, h / 2 + Math.cos(a) * h * .42); ctx.stroke(); }
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2, h * .82); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w * .4, h * .7); ctx.stroke();
  });
  mesh(new THREE.PlaneGeometry(.9, .9), basic({ map: clockFace, transparent: true }), scene, -11.3, 3.8, -16.95, false);

  const skin = material({ color: 0xc19470, roughness: .88 });
  const shirtBlue = material({ color: 0x234b65, roughness: .9 });
  const shirtSage = material({ color: 0xa0ae7e, roughness: .9 });
  const hair = material({ color: 0x29302a, roughness: 1 });
  function player(parent, x, z, rotation, shirt) {
    const group = new THREE.Group(); group.position.set(x, .2, z); group.rotation.y = rotation; parent.add(group);
    floorPlane(1.3, .8, contactMaterial, group, .13, .036, .12);
    mesh(new THREE.CapsuleGeometry(.15, .3, 4, 10), shirt, group, 0, 1.18, -.02);
    box(.32, .21, .23, black, group, 0, .84, 0);
    mesh(new THREE.SphereGeometry(.115, 12, 10), skin, group, 0, 1.58, -.035);
    mesh(new THREE.SphereGeometry(.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * .5), hair, group, 0, 1.6, -.035);
    rod([-.11, .79, 0], [-.25, .46, .13], .072, black, group);
    rod([.11, .79, 0], [.23, .47, -.17], .072, black, group);
    rod([-.25, .46, .13], [-.29, .12, .28], .052, skin, group);
    rod([.23, .47, -.17], [.33, .12, -.23], .052, skin, group);
    box(.16, .09, .3, white, group, -.29, .08, .2);
    box(.16, .09, .3, white, group, .33, .08, -.31);
    rod([-.15, 1.38, 0], [-.38, 1.12, -.12], .055, shirt, group);
    rod([-.38, 1.12, -.12], [-.47, 1.24, -.35], .04, skin, group);
    rod([.15, 1.38, 0], [.4, 1.21, -.1], .055, shirt, group);
    rod([.4, 1.21, -.1], [.5, 1.45, -.38], .04, skin, group);
    rod([.5, 1.45, -.38], [.6, 1.68, -.48], .015, steel, group);
    const racket = mesh(new THREE.TorusGeometry(.18, .012, 6, 20), trim, group, .65, 1.82, -.53);
    racket.scale.set(.76, 1, 1); racket.rotation.y = .5;
    mesh(new THREE.CircleGeometry(.17, 16), material({ color: 0xd1d8c7, transparent: true, opacity: .22, side: THREE.DoubleSide }), group, .65, 1.82, -.53, false).rotation.y = .5;
    return group;
  }

  function cone(parent, x, z) {
    box(.4, .045, .4, black, parent, x, .225, z);
    mesh(new THREE.ConeGeometry(.16, .55, 12), orange, parent, x, .52, z);
    mesh(new THREE.CylinderGeometry(.083, .105, .085, 12), white, parent, x, .54, z);
  }
  function makeCourt(id, x, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);
    const surface = material({ color: 0x39846b, map: rubber, bumpMap: rubber, bumpScale: .018, roughness: .88, metalness: 0 });
    box(7.36, .035, 14.48, material({ color: 0x294e41, roughness: .9 }), group, 0, .19, 0, false);
    const playingSurface = box(7.3, .025, 14.42, surface, group, 0, .219, 0, false);
    playingSurface.userData.courtId = id; pickable.push(playingSurface);
    const paintY = .235;
    const horizontal = (at, width = 6.1) => box(width, .005, .04, courtLine, group, 0, paintY, at, false);
    const vertical = (at, length = 13.4, center = 0) => box(.04, .005, length, courtLine, group, at, paintY, center, false);
    horizontal(-6.7); horizontal(6.7); vertical(-3.05); vertical(3.05);
    vertical(-2.59); vertical(2.59);
    for (const side of [-1, 1]) { horizontal(side * 5.94); horizontal(side * 1.98); vertical(0, 4.72, side * 4.34); }
    // Correct doubles/singles/service markings stay inside the playing mat.
    const number = label(String(id).padStart(2, '0'), { color: '#e3ebd9', font: '600 100px Arial', width: 256, height: 160 });
    floorPlane(1.0, .65, number.surface, group, -2.52, .241, 6.15);
    const brand = label('SMASH', { color: '#b3cdb7', font: '500 46px Arial', width: 256, height: 100 });
    floorPlane(1.6, .5, brand.surface, group, 0, .24, -7.0);
    const nets = new THREE.Group(); group.add(nets);
    for (const side of [-1, 1]) {
      box(.34, .1, .55, black, nets, side * 3.2, .29, 0);
      mesh(new THREE.CylinderGeometry(.045, .055, 1.55, 12), steel, nets, side * 3.2, 1.01, 0);
      mesh(new THREE.SphereGeometry(.06, 10, 8), white, nets, side * 3.2, 1.8, 0);
      rod([side * 3.2, .35, .21], [side * 3.2, .9, 0], .026, trim, nets);
    }
    const net = mesh(new THREE.PlaneGeometry(6.36, .76, 32, 1), netMaterial, nets, 0, 1.37, 0, true);
    // A slight central sag keeps the net from reading as a rigid pane.
    const positions = net.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getY(i) - .035 * (1 - Math.pow(positions.getX(i) / 3.18, 2)));
    positions.needsUpdate = true;
    const tapeCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-3.2, 1.77, 0), new THREE.Vector3(0, 1.735, 0), new THREE.Vector3(3.2, 1.77, 0)]);
    mesh(new THREE.TubeGeometry(tapeCurve, 28, .023, 5, false), white, nets);
    rod([-3.2, .99, 0], [3.2, .99, 0], .009, steel, nets);
    const occupants = new THREE.Group(); group.add(occupants);
    player(occupants, -.85, 3.4, Math.PI, shirtBlue); player(occupants, 1.0, -3.2, 0, shirtSage);
    const maintenance = new THREE.Group(); group.add(maintenance);
    cone(maintenance, -1.5, 1.0); cone(maintenance, 1.5, 1.0);
    rod([-1.5, .73, 1], [1.5, .73, 1], .025, orange, maintenance);
    const ring = new THREE.Group(); group.add(ring);
    const ringMaterial = material({ color: 0xd4df8a, emissive: 0xaabf48, emissiveIntensity: .22, roughness: .8 });
    box(7.48, .012, .06, ringMaterial, ring, 0, .26, -7.3, false);
    box(7.48, .012, .06, ringMaterial, ring, 0, .26, 7.3, false);
    box(.06, .012, 14.6, ringMaterial, ring, -3.74, .26, 0, false);
    box(.06, .012, 14.6, ringMaterial, ring, 3.74, .26, 0, false);
    const markerSurface = material({ color: 0x78ad85, roughness: .55, emissive: 0x2e5b40, emissiveIntensity: .12 });
    box(.8, .06, .16, markerSurface, group, 2.6, .25, 7.03, false);
    courts.set(id, { group, surface, playingSurface, occupants, maintenance, nets, ring, markerSurface, state: 'available', visible: true });
  }
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) makeCourt(row * 3 + col + 1, (col - 1) * 8.6, (row ? 1 : -1) * 8.0);

  function render() {
    frame = 0;
    if (!disposed && active && container.clientWidth && container.clientHeight) renderer.render(scene, camera);
  }
  function invalidate() { if (!disposed && active && !frame) frame = requestAnimationFrame(render); }
  function resize() {
    if (disposed) return;
    const width = container.clientWidth, height = container.clientHeight;
    // Hidden initial mounts and Flat mode retain the last real framing.
    if (!width || !height) return;
    const aspect = width / height;
    const nextFitFactor = Math.max(1, 1.35 / aspect);
    if (Math.abs(nextFitFactor - fitFactor) > .0001) {
      // Scale only camera distance: the user's orbit and relative zoom survive
      // phone/desktop changes and moving this element into the expanded dialog.
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(nextFitFactor / fitFactor);
      camera.position.copy(controls.target).add(offset);
      controls.minDistance = 34 * nextFitFactor;
      controls.maxDistance = 105 * nextFitFactor;
      fitFactor = nextFitFactor;
      controls.update();
    }
    renderer.setSize(width, height, false); camera.aspect = aspect; camera.updateProjectionMatrix(); invalidate();
  }
  function resetView() {
    controls.target.set(0, .8, 0);
    camera.position.copy(controls.target).add(new THREE.Vector3(31, 30.2, 36).multiplyScalar(fitFactor));
    controls.update(); invalidate();
  }
  function rotate(direction) {
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta = THREE.MathUtils.clamp(spherical.theta + Math.sign(direction) * Math.PI / 12, controls.minAzimuthAngle, controls.maxAzimuthAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical)); controls.update(); invalidate();
  }
  function zoom(direction) {
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * (direction > 0 ? .84 : 1.19), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setLength(distance)); controls.update(); invalidate();
  }
  function updateCourts(items) {
    for (const item of items) {
      const court = courts.get(item.id); if (!court) continue;
      court.state = item.state; court.visible = item.visible !== false;
      court.occupants.visible = court.visible && item.state === 'playing';
      court.maintenance.visible = item.state === 'blocked'; court.nets.visible = item.state !== 'blocked';
      court.ring.visible = court.visible && !!item.selected;
      court.surface.color.set(court.visible ? item.state === 'blocked' ? 0x547365 : 0x39846b : 0x8b9c8f);
      court.markerSurface.color.set(item.state === 'playing' ? 0x7399bd : item.state === 'arriving' ? 0xe7b970 : item.state === 'blocked' ? 0x899588 : 0x8cbe87);
      court.markerSurface.emissiveIntensity = court.visible ? .12 : 0;
    }
    invalidate();
  }
  function pointerDown(event) {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (event.pointerType === 'mouse') renderer.domElement.style.cursor = 'grabbing';
  }
  function pointerCancel() { pointerStart = null; renderer.domElement.style.cursor = 'grab'; }
  function pointerUp(event) {
    renderer.domElement.style.cursor = 'grab';
    if (!active || !pointerStart || event.pointerId !== pointerStart.id) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y); pointerStart = null;
    if (distance > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickable, false).find(item => courts.get(item.object.userData.courtId)?.visible);
    if (hit) onSelect(hit.object.userData.courtId);
  }
  function contextLost(event) { event.preventDefault(); active = false; onError(new Error('The 3D view is unavailable. The flat court map is still available.')); }
  function visibility() { if (!document.hidden) invalidate(); }
  controls.addEventListener('change', invalidate);
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerCancel);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', visibility);
  const observer = new ResizeObserver(resize); observer.observe(container);
  resetView(); resize();
  updateCourts(Array.from(courts.keys(), id => ({ id, state: [1, 4].includes(id) ? 'playing' : id === 2 ? 'arriving' : id === 6 ? 'blocked' : 'available', visible: true, selected: id === 3 })));

  return {
    updateCourts, resetView, rotate, zoom,
    setActive(value) { active = !!value; controls.enabled = active; if (active) { resize(); invalidate(); } },
    dispose() {
      if (disposed) return; disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect(); controls.removeEventListener('change', invalidate); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      document.removeEventListener('visibilitychange', visibility);
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
      key.shadow.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
