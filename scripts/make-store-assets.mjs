// Produces the Chrome Web Store graphics in store/: 1280×800 screenshots taken with the
// built extension running on local demo pages, and a 440×280 promo tile.
// Usage: npm run build && node scripts/make-store-assets.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(root, '.output', 'chrome-mv3');
const out = join(root, 'store');
mkdirSync(out, { recursive: true });

const W = 1280;
const H = 800;

// ---- demo content (original text, written for these screenshots) ----
const TITLE = 'فنّ الخط العربي: حين تصير الكتابة جمالًا';
const PARAS = [
  'الخط العربي ليس وسيلة لتدوين الكلام فحسب، بل فنٌّ قائم بذاته، تتعانق فيه الحروف وتتّصل كما تتّصل الأنغام في لحن واحد.',
  'ومنذ قرون تنوّعت مدارسه بين النسخ والثلث والكوفي والرقعة، ولكلّ خطّ منها طابعه وإيقاعه ومواضع استعماله.',
  'واليوم يقرأ الناس معظم ما يقرؤون على الشاشات، فصار اختيار الخط المناسب وضبط المسافات بين السطور جزءًا من راحة القارئ.',
];
const article = `<h1>${TITLE}</h1><p class="meta">مقال · 4 دقائق للقراءة</p>${PARAS.map((p) => `<p>${p}</p>`).join('')}`;

const CSS_BASE = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f1ec; color: #1c1b1a; font: 17px/1.35 Tahoma, Arial, sans-serif; }
  .label { display: inline-block; padding: 4px 14px; border-radius: 999px; font: 600 14px system-ui, sans-serif; letter-spacing: .02em; }
  .label.before { background: #e4e1dc; color: #55524d; }
  .label.after { background: #0f766e; color: #fff; }
  .card { background: #fff; border-radius: 14px; padding: 26px 30px; box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
  h1 { margin: 0 0 6px; font-size: 27px; }
  .meta { margin: 0 0 14px; color: #77736d; font-size: 14px; }
  p { margin: 0 0 12px; }
`;

/** Screenshot 1: the same Arabic article, untouched on one side and with Khatt on the other. */
const beforeAfterPage = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${CSS_BASE}
  body { padding: 44px 48px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: start; }
  .col > .label { margin-bottom: 14px; }
</style></head><body>
  <div class="cols">
    <div class="col"><span class="label after" dir="ltr" data-khatt-ignore>With Khatt</span><div class="card">${article}</div></div>
    <div class="col" data-khatt-ignore><span class="label before" dir="ltr">Before</span><div class="card">${article}</div></div>
  </div>
</body></html>`;

/** Screenshot 2: an English-language feed with Arabic posts — direction and alignment fixed. */
const posts = [
  ['Layla', 'شاهدت اليوم معرضًا رائعًا للخط العربي في وسط المدينة، أنصحكم بزيارته!'],
  ['Omar', 'Thanks for sharing — is it open on weekends?'],
  ['Layla', 'نعم، مفتوح يوميًا من الساعة 10 صباحًا حتى 8 مساءً.'],
  ['Sara', 'قائمة ما أعجبني:'],
];
const list = '<ul><li>لوحات الخط الكوفي</li><li>ورشة الخط للمبتدئين</li><li>ركن المخطوطات القديمة</li></ul>';
const feed = posts
  .map(([who, text], i) => `<div class="post"><b class="who">${who}</b><p>${text}</p>${i === 3 ? list : ''}</div>`)
  .join('');
const feedPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${CSS_BASE}
  body { padding: 44px 48px; font: 16px/1.4 "Segoe UI", Arial, sans-serif; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: start; }
  .col > .label { margin-bottom: 14px; }
  .post { background: #fff; border-radius: 14px; padding: 14px 18px; margin-bottom: 12px; box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
  .who { display: block; margin-bottom: 4px; font-size: 13px; color: #0f766e; }
  .post p { margin: 0; }
  ul { margin: 8px 0 0; }
  input { width: 100%; padding: 12px 16px; border: 1px solid #d6d2cb; border-radius: 999px; font: inherit; background: #fff; }
</style></head><body>
  <div class="cols">
    <div class="col" data-khatt-ignore><span class="label before">Before</span>${feed}<input value="اكتب ردًّا…" readonly></div>
    <div class="col"><span class="label after" data-khatt-ignore>With Khatt</span>${feed}<input id="reply" value="اكتب ردًّا…"></div>
  </div>
</body></html>`;

/** Screenshot 3 backdrop: a full-width Arabic article, shown behind the popup. */
const articlePage = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${CSS_BASE}
  body { padding: 40px 48px; }
  .card { max-width: 780px; padding: 36px 44px; }
  h1 { font-size: 32px; }
</style></head><body><div class="card">${article}${PARAS.map((p) => `<p>${p}</p>`).join('')}</div></body></html>`;

const pages = { '/before-after': beforeAfterPage, '/feed': feedPage, '/article': articlePage };
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pages[req.url] ?? '');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: { width: W, height: H },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const id = new URL(worker.url()).host;
const fontsReady = (page, n = 1) =>
  page.waitForFunction(
    (count) => [...document.fonts].filter((f) => f.status === 'loaded').length >= count,
    n,
  );
const shot = async (page, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, name), clip: { x: 0, y: 0, width: W, height: H } });
  console.log(`store/${name}`);
};

// 1 — before / after
let page = await context.newPage();
await page.goto(`${base}/before-after`);
await fontsReady(page);
await shot(page, 'screenshot-1-before-after.png');
await page.close();

// 2 — direction fixes on a left-to-right page
page = await context.newPage();
await page.goto(`${base}/feed`);
await fontsReady(page);
await shot(page, 'screenshot-2-direction.png');
await page.close();

// 3 — the popup over an article (popup captured separately, then placed where Chrome shows it)
const popup = await context.newPage();
await popup.setViewportSize({ width: 320, height: 600 });
await popup.goto(`chrome-extension://${id}/popup.html?host=example.com`);
await fontsReady(popup, 4);
await popup.waitForTimeout(400);
const popupPng = (await popup.screenshot({ fullPage: true })).toString('base64');
await popup.close();

page = await context.newPage();
await page.goto(`${base}/article`);
await fontsReady(page);
await page.evaluate((src) => {
  const img = document.createElement('img');
  img.src = `data:image/png;base64,${src}`;
  img.setAttribute('data-khatt-ignore', '');
  img.style.cssText =
    'position:fixed;top:16px;left:40px;width:320px;border-radius:10px;box-shadow:0 12px 40px rgb(0 0 0 / .28), 0 0 0 1px rgb(0 0 0 / .08)';
  document.body.append(img);
}, popupPng);
await shot(page, 'screenshot-3-popup.png');
await page.close();

// 4 — the options page
page = await context.newPage();
await page.goto(`chrome-extension://${id}/options.html`);
await fontsReady(page, 8);
await shot(page, 'screenshot-4-options.png');
await page.close();
await context.close();
server.close();

// Promo tile — plain page, no extension needed.
const kufi = readFileSync(join(root, 'public', 'fonts', 'noto-kufi-arabic.woff2')).toString('base64');
const browser = await chromium.launch();
const tile = await browser.newPage({ viewport: { width: 440, height: 280 } });
await tile.setContent(`<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Logo; src: url(data:font/woff2;base64,${kufi}) format("woff2"); font-weight: 100 900; }
  body { margin: 0; width: 440px; height: 280px; display: grid; place-content: center; justify-items: center; gap: 10px;
         background: linear-gradient(160deg, #14917f, #0b5f58); color: #fff; font-family: system-ui, "Segoe UI", sans-serif; }
  .word { font: 800 96px/1.25 Logo; }
  .name { font-size: 26px; font-weight: 600; letter-spacing: .04em; }
  .tag { font-size: 15px; opacity: .85; }
</style><div class="word">خط</div><div class="name">Khatt</div><div class="tag">Beautiful Arabic text on any website</div>`);
await tile.evaluate(() => document.fonts.ready);
await tile.screenshot({ path: join(out, 'promo-small-440x280.png') });
console.log('store/promo-small-440x280.png');
await browser.close();
