// Renders the Android launcher icons and splash screens from app-shell/icon.svg.
// Needs Playwright with Chromium (not a project dependency): node scripts/make-icons.cjs
// Only rerun when the icon changes; the PNGs it writes are committed.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const res = path.join(root, 'android/app/src/main/res');
const BG = '#f0532f';
const art = fs.readFileSync(path.join(root, 'app-shell/icon.svg'), 'utf8');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const page = (body, w, h, transparent) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${transparent ? 'transparent' : BG}">${body}</body></html>`;
const artImg = (size, style = '') => `<img src="data:image/svg+xml;base64,${Buffer.from(art).toString('base64')}" style="width:${size}px;height:${size}px;display:block;${style}">`;

(async () => {
  const browser = await chromium.launch();
  const shot = async (html, w, h, file, transparent) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html);
    await p.screenshot({ path: file, omitBackground: !!transparent });
    await p.close();
  };
  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = path.join(res, `mipmap-${d}`);
    const fg = Math.round(108 * k), legacy = Math.round(48 * k);
    // Adaptive foreground: the artwork alone, the system draws the background colour and mask.
    await shot(page(artImg(fg), fg, fg, true), fg, fg, path.join(dir, 'ic_launcher_foreground.png'), true);
    // Legacy icons (Android 7.x): artwork on a rounded square or a circle. The 108 canvas is scaled so its safe zone fills the shape.
    const inner = Math.round(legacy * 108 / 72), off = (legacy - inner) / 2;
    const legacyHtml = radius => page(`<div style="width:${legacy}px;height:${legacy}px;border-radius:${radius};background:${BG};overflow:hidden;position:relative">${artImg(inner, `position:absolute;left:${off}px;top:${off}px`)}</div>`, legacy, legacy, true);
    await shot(legacyHtml('22%'), legacy, legacy, path.join(dir, 'ic_launcher.png'), true);
    await shot(legacyHtml('50%'), legacy, legacy, path.join(dir, 'ic_launcher_round.png'), true);
    // Splash (pre-Android 12 shows this full screen; 12+ shows the launcher icon on the splash colour instead).
    for (const [o, w, h] of [['port', 320, 480], ['land', 480, 320]]) {
      const W = Math.round(w * k), H = Math.round(h * k), s = Math.round(Math.min(W, H) * 0.85);
      await shot(page(`<div style="display:grid;place-items:center;height:100%">${artImg(s)}</div>`, W, H), W, H, path.join(res, `drawable-${o}-${d}`, 'splash.png'));
    }
  }
  const s = 480 * 0.85;
  await shot(page(`<div style="display:grid;place-items:center;height:100%">${artImg(s)}</div>`, 480, 480), 480, 480, path.join(res, 'drawable', 'splash.png'));
  await browser.close();
  console.log('icons and splash screens written to', res);
})();
