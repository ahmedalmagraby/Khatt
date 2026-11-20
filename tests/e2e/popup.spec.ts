import { expect, test, type Page } from '@playwright/test';
import { launch, type Harness } from './harness';

let h: Harness;
let site: Page;
let popup: Page;

const SITE_KEY = 'site:127.0.0.1';

test.beforeAll(async () => {
  h = await launch();
});

test.afterAll(async () => {
  await h?.close();
});

test.beforeEach(async () => {
  await h.clearStorage();
  site = await h.context.newPage();
  await site.goto(`${h.base}/basic`);
  await expect(site.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  // The popup opened as a page, pointed at the fixture site.
  popup = await h.context.newPage();
  await popup.goto(`chrome-extension://${h.extensionId}/popup.html?host=127.0.0.1`);
  await expect(popup.locator('#host')).toHaveText('127.0.0.1');
});

test.afterEach(async () => {
  await popup.close();
  await site.close();
});

const siteCss = () => site.locator('#khatt-style').evaluate((el) => el.textContent ?? '');

test('shows defaults and every bundled font with a loaded preview', async () => {
  await expect(popup.locator('#master')).toBeChecked();
  await expect(popup.locator('#site-enabled')).toBeChecked();
  await expect(popup.locator('input[name="scope"][value="all"]')).toBeChecked();
  await expect(popup.locator('input[name="font"]')).toHaveCount(8);
  await expect(popup.locator('input[name="font"][value="ibm-plex-sans-arabic"]')).toBeChecked();
  await expect(popup.locator('#size-value')).toHaveText('100%');
  await expect(popup.locator('#override-note')).toBeHidden();

  await popup.waitForFunction(
    () => [...document.fonts].filter((f) => f.status === 'loaded').length >= 4,
  );
});

test('changing the font updates the open page live', async () => {
  await popup.locator('input[name="font"][value="vazirmatn"]').check();
  await expect.poll(siteCss).toContain('vazirmatn.woff2');
  expect((await h.getStorage()).global).toMatchObject({ fontId: 'vazirmatn' });
  expect(await h.getStorage()).not.toHaveProperty([SITE_KEY]);
  await site.waitForFunction(() =>
    [...document.fonts].some((f) => f.family.includes('Khatt Arabic') && f.status === 'loaded'),
  );
});

test('the size slider rescales Arabic glyphs only', async () => {
  const widthOf = (id: string) =>
    site.locator(id).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().width;
    });
  await site.waitForFunction(() =>
    [...document.fonts].some((f) => f.family.includes('Khatt Arabic') && f.status === 'loaded'),
  );
  const arabicBefore = await widthOf('#arabic');
  const latinBefore = await widthOf('#latin');

  await popup.locator('#size').fill('130');
  await expect(popup.locator('#size-value')).toHaveText('130%');
  await expect.poll(siteCss).toContain('size-adjust:130%');

  await expect.poll(() => widthOf('#arabic')).toBeGreaterThan(arabicBefore * 1.15);
  expect(await widthOf('#latin')).toBe(latinBefore);
});

test('typography and direction controls are saved', async () => {
  await popup.locator('#fine-tuning summary').click();
  await expect(popup.locator('#line-height-value')).toHaveText('1.7');
  await expect(popup.locator('#word-spacing-value')).toHaveText('Off');
  await expect(popup.locator('#fix-direction')).toBeChecked();

  await popup.locator('#line-height').fill('2');
  await expect(popup.locator('#line-height-value')).toHaveText('2.0');
  await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ lineHeight: 2 });

  // The lowest position means "leave the site's line height alone".
  await popup.locator('#line-height').fill('1.3');
  await expect(popup.locator('#line-height-value')).toHaveText('Off');
  await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ lineHeight: 0 });

  await popup.locator('#word-spacing').fill('0.1');
  await expect(popup.locator('#word-spacing-value')).toHaveText('+0.10em');
  await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ wordSpacing: 0.1 });
  await expect.poll(siteCss).toContain('word-spacing:0.1em');

  await popup.locator('#fix-direction').uncheck();
  await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ fixDirection: false });
  await expect(site.locator('[data-khatt-dir]')).toHaveCount(0);
});

test('presets apply a bundle of settings and show as active', async () => {
  const naskh = popup.locator('button[data-preset="naskh"]');
  await expect(popup.locator('#preset-list button')).toHaveCount(4);
  await expect(popup.locator('#preset-list button[aria-pressed="true"]')).toHaveCount(0);

  await naskh.click();
  await expect(naskh).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('input[name="font"][value="noto-naskh-arabic"]')).toBeChecked();
  await expect(popup.locator('#size-value')).toHaveText('110%');
  expect((await h.getStorage()).global).toMatchObject({
    fontId: 'noto-naskh-arabic',
    sizeAdjust: 110,
    lineHeight: 2,
    wordSpacing: 0,
  });
  await expect.poll(siteCss).toContain('noto-naskh-arabic.woff2');

  // Changing any value away from the preset clears the highlight.
  await popup.locator('#size').fill('100');
  await expect(naskh).toHaveAttribute('aria-pressed', 'false');
});

test('reading aids are saved and applied', async () => {
  await popup.locator('#reading-aids summary').click();
  await expect(popup.locator('#hide-tashkeel')).not.toBeChecked();
  await expect(popup.locator('#numerals')).toHaveValue('off');
  await expect(popup.locator('#justify')).not.toBeChecked();

  await popup.locator('#hide-tashkeel').check();
  await popup.locator('#numerals').selectOption('arabic-indic');
  await popup.locator('#justify').check();
  await expect
    .poll(async () => (await h.getStorage()).global)
    .toMatchObject({ hideTashkeel: true, numerals: 'arabic-indic', justify: true });
  await expect.poll(siteCss).toContain('text-align:justify');
});

test('offers the installed font once one is named, and links to the options page', async () => {
  await expect(popup.locator('input[name="font"][value="system"]')).toHaveCount(0);
  await h.setLocal({ systemFont: 'Tahoma' });
  const card = popup.locator('input[name="font"][value="system"]');
  await expect(card).toHaveCount(1);
  await card.check();
  await expect.poll(siteCss).toContain('src:local("Tahoma")');
  await h.setLocal({ systemFont: '' });
  await expect(card).toHaveCount(0);

  const [optionsPage] = await Promise.all([
    h.context.waitForEvent('page'),
    popup.locator('#open-options').click(),
  ]);
  expect(optionsPage.url()).toContain('/options.html');
  await optionsPage.close();
});

test('site switch turns Khatt off for this site only', async () => {
  await popup.locator('#site-enabled').uncheck();
  await expect(site.locator('[data-khatt]')).toHaveCount(0);
  expect((await h.getStorage())[SITE_KEY]).toEqual({ enabled: false });

  await popup.locator('#site-enabled').check();
  await expect(site.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  // Back to defaults — nothing left in storage for the site.
  expect(await h.getStorage()).not.toHaveProperty([SITE_KEY]);
});

test('master switch turns Khatt off everywhere', async () => {
  await popup.locator('#master').uncheck();
  await expect(site.locator('[data-khatt]')).toHaveCount(0);
  await expect(popup.locator('#controls')).toHaveClass(/off/);

  await popup.locator('#master').check();
  await expect(site.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
});

test('"this site only" stores an override that can be reset', async () => {
  await popup.locator('input[name="scope"][value="site"]').check();
  await popup.locator('input[name="font"][value="noto-naskh-arabic"]').check();

  await expect.poll(siteCss).toContain('noto-naskh-arabic.woff2');
  const stored = await h.getStorage();
  expect(stored[SITE_KEY]).toEqual({ overrides: { fontId: 'noto-naskh-arabic' } });
  expect(stored.global).toBeUndefined();
  await expect(popup.locator('#override-note')).toBeVisible();

  // Global view still shows the global font.
  await popup.locator('input[name="scope"][value="all"]').check();
  await expect(popup.locator('input[name="font"][value="ibm-plex-sans-arabic"]')).toBeChecked();

  await popup.locator('#reset-site').click();
  await expect(popup.locator('#override-note')).toBeHidden();
  await expect.poll(siteCss).toContain('ibm-plex-sans-arabic-400.woff2');
  expect(await h.getStorage()).not.toHaveProperty([SITE_KEY]);
});

test('reopening on a site with overrides starts in site scope', async () => {
  await h.setStorage({ [SITE_KEY]: { overrides: { fontId: 'noto-kufi-arabic', sizeAdjust: 110 } } });
  await popup.reload();
  await expect(popup.locator('input[name="scope"][value="site"]')).toBeChecked();
  await expect(popup.locator('input[name="font"][value="noto-kufi-arabic"]')).toBeChecked();
  await expect(popup.locator('#size-value')).toHaveText('110%');
});

test('pages where Khatt cannot run show only global controls', async () => {
  // Opened without a host, the active tab is the popup page itself — not a website.
  await popup.goto(`chrome-extension://${h.extensionId}/popup.html`);
  await expect(popup.locator('#unavailable')).toBeVisible();
  await expect(popup.locator('#site-section')).toBeHidden();
  await expect(popup.locator('input[name="scope"][value="site"]')).toBeDisabled();
  await expect(popup.locator('input[name="font"]')).toHaveCount(8);
});

test('a slider value still waiting to be saved is saved when the popup closes', async () => {
  await popup.evaluate(() => {
    const slider = document.getElementById('size') as HTMLInputElement;
    slider.value = '125';
    slider.dispatchEvent(new Event('input'));
    // Closing at once: the popup's own debounced write never runs; the background saves it.
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ sizeAdjust: 125 });
});

test('the background only takes slider values from the save message, held to their range', async () => {
  await popup.evaluate(() =>
    (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({
      type: 'khatt:save',
      host: null,
      patch: { enabled: false, sizeAdjust: 9999 },
    }),
  );
  await expect.poll(async () => ((await h.getStorage()).global as { sizeAdjust?: number } | undefined)?.sizeAdjust).toBeGreaterThan(100);
  expect(((await h.getStorage()).global as Record<string, unknown>).sizeAdjust).toBeLessThan(9999);
  expect((await h.getStorage()).global).not.toHaveProperty('enabled');
});
