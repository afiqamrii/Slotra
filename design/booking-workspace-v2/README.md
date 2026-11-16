# Visual booking workspace concept

Open **`standalone.html`** for the self-contained, offline preview. `index.html` loads the same source as separate local files for development. All venue, customer, court, booking and payment details are synthetic. No real reservation or payment is written.

## Realistic 3D hall

The earlier tilted tiles have been replaced with a genuine interactive WebGL scene:

- Six green sports surfaces with textured materials and doubles/singles/service markings.
- Upright net meshes, top bands, posts, subtle net sag and small contact shadows.
- Timber walkways, benches, players, equipment, wall panels, glazing and lighting fixtures.
- Perspective, cast shadows and bounded orbit/zoom controls. Selection highlights the physical court and its matching HTML status card.
- Expandable venue view, reset camera, rotation buttons and zoom buttons. Wheel and touch scrolling remain available for navigating the page.
- Flat view and keyboard-accessible court buttons retain the booking flow. A renderer failure falls back to Flat view.

This is an illustrative cutaway, not a measured model of an actual venue. Physical details add context while text labels keep court status understandable without relying on colour.

The renderer draws on demand, caps pixel density and releases its resources on teardown. It has no automatic rotation or continuous animation. Three.js 0.187.0 is bundled locally under its MIT license; no runtime CDN, model download, font or external texture is required. The production application's dependencies are unchanged.

## Preview interactions

1. Select a court directly in the scene or through its status card.
2. Switch 3D / Flat while retaining the selected court.
3. Rotate, zoom, reset or expand the hall. Escape closes expanded view and restores focus.
4. Filter courts by status and move between sample days. Selection reconciles with the active filter; search clears a conflicting filter when opening another court.
5. Open a court, choose time/duration and enter a sample customer name. The result explicitly states that nothing has been reserved.
6. Inspect arrival cards and timeline sessions; sample check-in/completion does not alter real data.
7. Use quick search and the mobile navigation menu.

## Rebuild

From the repository root, install the pinned preview dependency into its ignored tools directory and build:

```sh
npm install --prefix .billing-verification/realistic-3d-tools --no-audit --no-fund --ignore-scripts --save-exact three@0.187.0
node design/booking-workspace-v2/build-preview.mjs
```

The build uses the repository's existing esbuild dependency. It checks the Three.js version, bundles the scene without external imports, copies the license and emits `standalone.html` with embedded styles, scripts and license text. Maintain `venue-scene.js`, `preview.js`, `styles.css`, `venue-view.css` and `index.html`; rebuild the generated bundle and standalone page after source changes.

## Verification

- Source syntax, offline bundle build and whole-repository ESLint passed.
- Browser checks covered direct 3D court picking, rotation, zoom/reset, expanded view, nested booking dialog, sample booking feedback, Escape and focus restoration.
- Status/day changes and Flat/3D selection consistency passed. The unavailable-filter selection defect found in review was corrected.
- Desktop (1280px), phone (390px) and expanded tablet (700px) layouts were inspected. The phone document and tablet status cards had no horizontal overflow.
- The standalone document rendered its WebGL canvas with no external script, stylesheet or image elements. No console warnings or errors were captured.
- Unsupported-WebGL recovery is implemented and source-reviewed; a real unsupported-GPU device was not available for testing.

This remains separate from production routes for visual review. Sidebar secondary destinations demonstrate placement, not complete reporting, payment or settings applications.

Screenshots: [Expanded hall](preview-realistic-expanded.png), [Desktop workspace](preview-3d.png), [Flat view](preview-flat.png), [Phone layout](preview-mobile.png).
