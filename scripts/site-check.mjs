// Loads the built extension in Chromium and visits real sites, reporting what Khatt did on each.
// Usage: npm run build && node scripts/site-check.mjs [outDir] [url ...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(root, '.output', 'chrome-mv3');
const [outArg, ...urlArgs] = process.argv.slice(2);
const outDir = resolve(outArg ?? join(root, 'test-results', 'site-check'));
mkdirSync(outDir, { recursive: true });

const urls = urlArgs.length
  ? urlArgs
  : [
      'https://ar.wikipedia.org/wiki/اللغة_العربية',
      'https://en.wikipedia.org/wiki/Arabic',
      'https://www.aljazeera.net/',
      'https://www.bbc.com/arabic',
      'https://www.bbc.com/persian',
      'https://www.bbc.com/urdu',
      'https://github.com/topics/arabic',
    ];

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

for (const url of urls) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error' && /khatt|chrome-extension/i.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  await page.addInitScript(() => {
    window.__long = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  });
  const name = new URL(url).hostname + new URL(url).pathname.replace(/[^a-z0-9]+/gi, '_').slice(0, 20);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    const report = await page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const arabic = /[؀-ۿ]/;
      // Arabic text nodes whose parent was not tagged (outside code blocks and editors).
      let missed = 0;
      let arabicNodes = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode()); ) {
        if (!arabic.test(n.data)) continue;
        const p = n.parentElement;
        if (!p || p.closest('script,style,noscript,template,pre,code,kbd,samp,[contenteditable]')) continue;
        arabicNodes++;
        if (!p.hasAttribute('data-khatt')) missed++;
      }
      const sample = document.querySelector('p[data-khatt]') ?? document.querySelector('[data-khatt]');
      return {
        rootDir: getComputedStyle(document.documentElement).direction,
        tagged: q('[data-khatt]'),
        arabicNodes,
        missed,
        prose: q('[data-khatt-prose]'),
        dirAuto: q('[data-khatt-dir="auto"]'),
        dirBidi: q('[data-khatt-dir="bidi"]'),
        dirRtl: q('[data-khatt-dir="rtl"]'),
        fields: q('[data-khatt-auto-dir]'),
        styleAttached: !!document.getElementById('khatt-style'),
        fontLoaded: [...document.fonts].some((f) => f.family.includes('Khatt Arabic') && f.status === 'loaded'),
        sampleFont: sample ? getComputedStyle(sample).fontFamily.slice(0, 70) : null,
        longTasks: window.__long.length,
        worstLongTask: Math.max(0, ...window.__long),
        scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    });
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(JSON.stringify({ url, ...report, errors }));
  } catch (err) {
    console.log(JSON.stringify({ url, failed: String(err).slice(0, 200) }));
  }
  await page.close();
}
await context.close();
console.log(`screenshots: ${outDir}`);
