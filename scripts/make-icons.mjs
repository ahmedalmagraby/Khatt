// Renders the extension icons (public/icon/<size>.png) from the logo: the word "خط"
// (or just "خ" at small sizes) on a teal rounded square, drawn in a bundled font.
// Usage: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icon');
mkdirSync(out, { recursive: true });

const font = readFileSync(join(root, 'public', 'fonts', 'noto-kufi-arabic.woff2')).toString('base64');

/** size → [text, artwork size inside the canvas, font size, upward nudge] */
const icons = {
  16: ['خ', 16, 10, 2.5],
  32: ['خ', 32, 20, 5],
  48: ['خط', 48, 25, 3],
  // Store guidance: 96px artwork centred in a 128px canvas.
  128: ['خط', 96, 50, 6],
};

export const logoHtml = (size, [text, art, fontSize, nudge]) => `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: Logo; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; background: transparent; }
  #canvas { width: ${size}px; height: ${size}px; display: grid; place-items: center; }
  #art {
    width: ${art}px; height: ${art}px; border-radius: ${Math.round(art * 0.22)}px;
    background: linear-gradient(160deg, #14917f, #0b5f58);
    display: grid; place-items: center; overflow: hidden;
    color: #fff; font: 800 ${fontSize}px/1 Logo; direction: rtl;
  }
  #art span { display: block; transform: translateY(-${nudge}px); }
</style>
<div id="canvas"><div id="art"><span>${text}</span></div></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [size, spec] of Object.entries(icons)) {
  await page.setViewportSize({ width: Number(size), height: Number(size) });
  await page.setContent(logoHtml(size, spec));
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#canvas').screenshot({ path: join(out, `${size}.png`), omitBackground: true });
  console.log(`icon/${size}.png`);
}
await browser.close();
