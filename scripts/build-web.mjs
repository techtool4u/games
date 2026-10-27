// Builds www/, the web bundle Capacitor packages into the Android app.
// The site's HTML pages are copied unchanged except for three app-only tweaks:
//   1. Google Fonts are downloaded into www/fonts/ so the app works offline and makes no network requests.
//   2. app-shell.css / app-shell.js are linked in (Android back button, no long-press text selection, etc.).
//   3. The fonts preconnect hint is dropped.
// Run with: npm run build:web
import { readdir, readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'www');
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const SUBSETS = new Set(['latin', 'latin-ext']); // the games only use Latin text

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'fonts'), { recursive: true });

const pages = (await readdir(root)).filter(f => f.endsWith('.html'));
if (!pages.includes('index.html')) throw new Error('index.html not found in ' + root);

const fontFiles = new Map(); // remote url -> local file name
async function localFont(url) {
  if (fontFiles.has(url)) return fontFiles.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = createHash('sha1').update(url).digest('hex').slice(0, 12) + path.extname(new URL(url).pathname);
  await writeFile(path.join(out, 'fonts', name), buf);
  fontFiles.set(url, name);
  return name;
}

// Fetch one Google Fonts stylesheet and return local CSS that points at downloaded files.
async function localizeFontCss(href) {
  const res = await fetch(href.replace(/&amp;/g, '&'), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fonts css: HTTP ${res.status}`);
  const css = await res.text();
  const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g)].filter(m => SUBSETS.has(m[1]));
  let outCss = '';
  for (const [, , block] of blocks) {
    let b = block;
    for (const [, url] of block.matchAll(/url\((https:[^)]+)\)/g)) b = b.replace(url, await localFont(url)); // same folder as the CSS
    outCss += b + '\n';
  }
  return outCss;
}

const fontLink = /<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/[^"]+)">/;
const preconnect = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n?/;

for (const page of pages) {
  let html = await readFile(path.join(root, page), 'utf8');
  html = html.replace(preconnect, '');
  const m = html.match(fontLink);
  if (m) {
    let css = '';
    try { css = await localizeFontCss(m[1]); }
    catch (e) { console.warn(`! ${page}: could not download fonts (${e.message}); the app will use system fonts`); }
    const cssName = 'fonts/' + page.replace(/\.html$/, '.css');
    await writeFile(path.join(out, cssName), css);
    html = html.replace(m[0], `<link rel="stylesheet" href="${cssName}">`);
  }
  html = html.replace('</head>', '<link rel="stylesheet" href="app-shell.css">\n</head>');
  const tag = '<script src="app-shell.js"></script>';
  html = html.includes('</body>') ? html.replace('</body>', tag + '\n</body>') : html + '\n' + tag + '\n';
  await writeFile(path.join(out, page), html);
  console.log('✓', page);
}

for (const f of ['app-shell.css', 'app-shell.js']) await copyFile(path.join(root, 'app-shell', f), path.join(out, f));
console.log(`www/ ready: ${pages.length} pages, ${fontFiles.size} font files`);
