import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../..');
const modules = resolve(repository, '.billing-verification/realistic-3d-tools/node_modules');
const threePackage = JSON.parse(await readFile(resolve(modules, 'three/package.json'), 'utf8'));
if (threePackage.version !== '0.187.0') {
  throw new Error('Install the pinned preview dependency: three@0.187.0');
}

const result = await build({
  entryPoints: [resolve(directory, 'venue-scene.js')],
  outfile: resolve(directory, 'venue-scene.bundle.js'),
  nodePaths: [modules],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'SlotraVenue3D',
  target: ['es2020'],
  legalComments: 'eof',
  metafile: true,
  banner: { js: '/* eslint-disable -- Generated offline preview bundle. Review venue-scene.js and rebuild with build-preview.mjs. */' },
});

for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(item => item.external)) throw new Error('The preview must not load runtime dependencies from the network.');
}
const license = await readFile(resolve(modules, 'three/LICENSE'), 'utf8');
await writeFile(resolve(directory, 'THIRD_PARTY_LICENSES.txt'), `Three.js ${threePackage.version}\nhttps://threejs.org/\n\n${license}`);
let standalone = await readFile(resolve(directory, 'index.html'), 'utf8');
for (const name of ['styles.css', 'venue-view.css']) {
  const css = await readFile(resolve(directory, name), 'utf8');
  standalone = standalone.replace(`<link rel="stylesheet" href="${name}">`, () => `<style>\n${css}\n</style>`);
}
for (const name of ['venue-scene.bundle.js', 'preview.js']) {
  const source = (await readFile(resolve(directory, name), 'utf8')).replace(/<\/script/gi, '<\\/script');
  standalone = standalone.replace(`<script src="${name}"></script>`, () => `<script>\n${source}\n</script>`);
}
standalone = standalone.replace('</head>', () => `<!-- Three.js ${threePackage.version}\n${license}\n-->\n</head>`);
await writeFile(resolve(directory, 'standalone.html'), standalone);
console.log(`Built offline 3D preview with Three.js ${threePackage.version}.`);
