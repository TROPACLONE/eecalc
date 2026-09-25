// Build: bundle + minify into dist/ (the folder you publish). Network and Chat are separate chunks
// loaded on first use; every file is listed for the service worker's offline cache.
import { build, transform } from 'esbuild';
import fs from 'fs';
import crypto from 'crypto';
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist');
await build({ entryPoints: ['src/app.js'], bundle: true, splitting: true, minify: true, format: 'esm', target: ['safari18'],
              outdir: 'dist', entryNames: '[name]', chunkNames: 'c-[hash]', legalComments: 'inline', logLevel: 'warning' });
let html = fs.readFileSync('src/index.html', 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
html = html.replace(css, (await transform(css, { loader: 'css', minify: true })).code.trim()).replace(/\n\s*/g, '\n');
fs.writeFileSync('dist/index.html', html);
for (const f of ['manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(`src/${f}`, `dist/${f}`);
// station logos: served from logos/, not precached (the service worker caches each one the first time it is shown)
if (fs.existsSync('src/logos')) fs.cpSync('src/logos', 'dist/logos', { recursive: true });
const files = fs.readdirSync('dist').filter(f => f !== 'sw.js' && fs.statSync(`dist/${f}`).isFile()).sort();
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(fs.readFileSync(`dist/${f}`));
if (fs.existsSync('dist/logos')) for (const f of fs.readdirSync('dist/logos').sort()) hash.update(f).update(fs.readFileSync(`dist/logos/${f}`));
const version = hash.digest('hex').slice(0, 12);
const list = ['./', ...files.map(f => './' + f)];
fs.writeFileSync('dist/sw.js', fs.readFileSync('src/sw.js', 'utf8').replace('__HASH__', version)
  .replace(/const FILES = \[[^\]]*\];/, `const FILES = ${JSON.stringify(list)};`));
const size = f => fs.statSync(`dist/${f}`).size, kb = n => (n / 1024).toFixed(1) + ' KB';
const logos = fs.existsSync('dist/logos') ? fs.readdirSync('dist/logos') : [];
const logoBytes = logos.reduce((s, f) => s + size(`logos/${f}`), 0);
console.log(`dist/ built (version ${version}):`);
for (const f of [...files, 'sw.js']) console.log('  ' + f.padEnd(22) + kb(size(f)));
console.log('  total '.padEnd(24) + kb([...files, 'sw.js'].reduce((s, f) => s + size(f), 0)) + ' (precached)');
if (logos.length) console.log(`  logos/ ${logos.length} files`.padEnd(24) + kb(logoBytes) + ' (cached when first shown)');
