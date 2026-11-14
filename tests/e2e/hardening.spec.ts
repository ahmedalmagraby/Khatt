import { expect, test, type Page } from '@playwright/test';
import { launch, type Harness } from './harness';

let h: Harness;
let page: Page;

test.beforeAll(async () => {
  h = await launch();
});

test.afterAll(async () => {
  await h?.close();
});

test.beforeEach(async () => {
  await h.clearStorage();
  page = await h.context.newPage();
});

test.afterEach(async () => {
  await page.close();
});

const open = async (path: string, ready: string) => {
  await page.goto(`${h.base}${path}`);
  await expect(page.locator(ready)).toHaveAttribute('data-khatt', /\d+/);
};

const style = (selector: string, prop: string) =>
  page.locator(selector).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test("wins over a site's own !important font and spacing rules", async () => {
  await open('/hard', '#forced');
  expect(await style('#forced', 'font-family')).toMatch(/^"Khatt Arabic", "Courier New", monospace$/);
  expect(await style('#forced', 'letter-spacing')).toMatch(/^(normal|0px)$/);
});

test('rich-text editors get the font but nothing inside them is touched', async () => {
  await open('/hard', '#editor');
  expect(await style('#ed-p', 'font-family')).toContain('Khatt Arabic');
  // No attributes may leak into content the user owns.
  const marked = '[data-khatt],[data-khatt-prose],[data-khatt-dir],[data-khatt-justify],[dir]';
  await expect(page.locator('#editor').locator(marked)).toHaveCount(0);
  await expect(page.locator('#editor')).not.toHaveAttribute('data-khatt-dir', /.*/);
  await expect(page.locator('#editor')).not.toHaveAttribute('dir', /.*/);

  // Typing and inserting new blocks keeps it that way.
  await page.locator('#ed-p').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' كتابة جديدة');
  await page.keyboard.press('Enter');
  await page.keyboard.type('فقرة أخرى');
  await page.waitForTimeout(200);
  await expect(page.locator('#editor').locator(marked)).toHaveCount(0);
  await expect(page.locator('#editor')).toContainText('فقرة أخرى');

  // Rewrites never reach editor content either.
  await h.setStorage({ global: { hideTashkeel: true, numerals: 'arabic-indic' } });
  await expect(page.locator('#forced')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#editor').locator(marked)).toHaveCount(0);

  // contenteditable="false" is ordinary content.
  await expect(page.locator('#ne-p')).toHaveAttribute('data-khatt', /\d+/);
});

test('a document in design mode is left entirely alone', async () => {
  await page.goto(`${h.base}/design`);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-khatt]')).toHaveCount(0);
});

test('picks up a shadow root attached to an element already on the page', async () => {
  await open('/hard', '#forced');
  await page.locator('#late-host').evaluate((host) => {
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<p id="late">نص في ظل أضيف لاحقا</p>';
  });
  const late = page.locator('#late-host #late');
  await expect(late).toHaveAttribute('data-khatt', /\d+/);
  expect(await late.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Khatt Arabic');

  // attachShadow itself still behaves normally for the page.
  const ok = await page.evaluate(() => {
    const el = document.createElement('div');
    document.body.append(el);
    const closed = el.attachShadow({ mode: 'closed' });
    return closed instanceof ShadowRoot && el.shadowRoot === null;
  });
  expect(ok).toBe(true);
});

test('re-tags elements when a library strips the attributes', async () => {
  await open('/hard', '#morph');
  await expect(page.locator('#morph-field')).toHaveAttribute('data-khatt', /\d+/);
  await page.evaluate(() => {
    for (const id of ['morph', 'morph-field']) {
      const el = document.getElementById(id)!;
      for (const name of el.getAttributeNames()) {
        if (name.startsWith('data-khatt') || name === 'dir') el.removeAttribute(name);
      }
    }
  });
  await expect(page.locator('#morph')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#morph-field')).toHaveAttribute('data-khatt', /\d+/);
  expect(await style('#morph', 'font-family')).toContain('Khatt Arabic');
});

test('still loads the font where the site blocks extension URLs', async () => {
  // First visit installs the site's service worker; the reload is then controlled by it.
  await page.goto(`${h.base}/sw-page`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);

  const loaded = () =>
    page.evaluate(() =>
      [...document.fonts]
        .filter((f) => f.family.includes('Khatt Arabic') && f.status === 'loaded')
        .map((f) => f.family.replace(/"/g, '')),
    );
  await expect.poll(loaded, { timeout: 10_000 }).toContain('Khatt Arabic');
  // The blocked url() rules are gone, so nothing keeps failing.
  expect(await page.locator('#khatt-style').evaluate((el) => el.textContent)).not.toContain('@font-face');

  // Changing font, size and heading font keeps working through the fallback.
  await h.setStorage({ global: { fontId: 'amiri', headingFontId: 'vazirmatn', sizeAdjust: 120 } });
  await expect.poll(loaded, { timeout: 10_000 }).toContain('Khatt Arabic Heading');
  const faces = await page.evaluate(() =>
    [...document.fonts]
      .filter((f) => f.family.includes('Khatt Arabic'))
      .map((f) => `${f.family.replace(/"/g, '')}|${f.weight}|${(f as FontFace & { sizeAdjust: string }).sizeAdjust}|${f.status}`)
      .sort(),
  );
  expect(faces).toEqual([
    'Khatt Arabic Heading|100 900|115%|loaded',
    'Khatt Arabic|400|132%|loaded',
    'Khatt Arabic|700|132%|loaded',
  ]);

  // Switching Khatt off removes the registered fonts too.
  await h.setStorage({ global: { enabled: false } });
  await expect
    .poll(() => page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Khatt')).length))
    .toBe(0);

  // The worker would otherwise keep controlling this origin for the tests that follow.
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      await registration.unregister();
    }
  });
});

/** Long tasks (>50ms) on the page from load until tagging settles. */
async function measure(path: string, settled: (p: Page) => Promise<void>) {
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__long.push(Math.round(entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
  const start = Date.now();
  await page.goto(`${h.base}${path}`);
  await settled(page);
  const elapsed = Date.now() - start;
  await page.waitForTimeout(300);
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  return { elapsed, worst: Math.max(0, ...long), total: long.reduce((a, b) => a + b, 0) };
}

test('tags a very large Arabic page quickly without long freezes', async () => {
  test.setTimeout(90_000);
  const count = 5000;

  await h.setStorage({ global: { enabled: false } });
  const baseline = await measure(`/big?n=${count}&lang=ar`, async (p) => {
    await p.waitForFunction((n) => document.querySelectorAll('p').length >= n, count);
  });

  await h.setStorage({ global: { enabled: true } });
  const khatt = await measure(`/big?n=${count}&lang=ar`, async (p) => {
    await p.waitForFunction(
      (n) => document.querySelectorAll('p[data-khatt]').length >= n,
      count,
      { timeout: 60_000 },
    );
  });
  console.log(`large page: baseline ${JSON.stringify(baseline)} with Khatt ${JSON.stringify(khatt)}`);

  expect(khatt.elapsed).toBeLessThan(15_000);
  // Work is sliced, so no single freeze should be much worse than the page's own.
  expect(khatt.worst).toBeLessThan(Math.max(250, baseline.worst * 2));
});

test('costs next to nothing on a large page with no Arabic', async () => {
  test.setTimeout(60_000);
  const count = 5000;
  const khatt = await measure(`/big?n=${count}&lang=en`, async (p) => {
    await p.waitForFunction((n) => document.querySelectorAll('p').length >= n, count);
  });
  console.log(`large Latin page with Khatt ${JSON.stringify(khatt)}`);
  await expect(page.locator('[data-khatt]')).toHaveCount(0);
  await expect(page.locator('#khatt-style')).toHaveCount(1);
});

// Evaluated inside extension contexts (service worker, popup page).
declare const chrome: {
  tabs: { query(q: { url: string }): Promise<{ id?: number }[]> };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  scripting: { executeScript(details: unknown): Promise<unknown> };
};

test('starts in an already-open tab without a refresh, and never runs twice on a page', async () => {
  await open('/basic', '#arabic');
  const sw = await h.worker();
  const tabId = await sw.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    `${h.base}/*`,
  );
  expect(typeof tabId).toBe('number');
  const css = () => page.locator('#khatt-style').evaluate((el) => el.textContent ?? '');

  // Leave the tab as it is after an extension update: no live Khatt script.
  await page.evaluate(() => document.dispatchEvent(new Event('khatt:takeover')));
  await expect(page.locator('[data-khatt]')).toHaveCount(0);
  await expect(page.locator('#khatt-style')).toHaveCount(0);
  await h.setStorage({ global: { fontId: 'amiri' } });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-khatt]')).toHaveCount(0);

  // Opening the popup on that tab asks the background to make sure Khatt is running there.
  const popup = await h.context.newPage();
  await popup.goto(`chrome-extension://${h.extensionId}/popup.html?host=127.0.0.1`);
  const ensure = () =>
    popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'khatt:ensure', tabId: id }), tabId);
  expect(await ensure()).toEqual({ status: 'injected' });
  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  await expect.poll(css).toContain('amiri-400.woff2');
  // Asking again does nothing: a live script answers.
  expect(await ensure()).toEqual({ status: 'alive' });
  await expect(page.locator('#khatt-style')).toHaveCount(1);

  // Settings changed afterwards apply live.
  await h.setStorage({ global: { fontId: 'vazirmatn' } });
  await expect.poll(css).toContain('vazirmatn.woff2');

  // Injecting on top of a live instance (what an update does) leaves exactly one in charge.
  await sw.evaluate(
    (id) =>
      chrome.scripting.executeScript({
        target: { tabId: id, allFrames: true },
        files: ['content-scripts/content.js'],
      }),
    tabId,
  );
  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#dynamic')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#khatt-style')).toHaveCount(1);
  await h.setStorage({ global: { fontId: 'tajawal' } });
  await expect.poll(css).toContain('tajawal-400.woff2');
  expect(await css()).not.toContain('vazirmatn.woff2');
  await expect(page.locator('#khatt-style')).toHaveCount(1);
  // The frame inside the page was taken over too.
  await expect(page.frameLocator('#frame').locator('#framed')).toHaveAttribute('data-khatt', /\d+/);
  await popup.close();
});
