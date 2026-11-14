import { expect, test, type Page } from '@playwright/test';
import { launch, type Harness } from './harness';

let h: Harness;

test.beforeAll(async () => {
  h = await launch();
});

test.afterAll(async () => {
  await h?.close();
});

const fontFamily = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => getComputedStyle(el).fontFamily);

/** True once a Khatt face has actually been downloaded and used for rendering. */
const khattFontLoaded = (page: Page) =>
  page.waitForFunction(() =>
    [...document.fonts].some((f) => f.family.includes('Khatt Arabic') && f.status === 'loaded'),
  );

test('replaces the font of Arabic text only', async () => {
  const page = await h.context.newPage();
  await page.goto(`${h.base}/basic`);

  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  expect(await fontFamily(page, '#arabic')).toMatch(/^"Khatt Arabic", Georgia, serif$/);
  await khattFontLoaded(page);

  // The site's own stack stays as the fallback, per element.
  await expect(page.locator('#mixed')).toHaveAttribute('data-khatt', /\d+/);
  expect(await fontFamily(page, '#mixed')).toMatch(/^"Khatt Arabic", Verdana, sans-serif$/);
  expect(await fontFamily(page, '#inner-arabic')).toMatch(/^"Khatt Arabic", Verdana, sans-serif$/);

  // Latin-only, icon, code and ignored elements are untouched.
  for (const id of ['#latin', '#inner-latin', '#icon', '#pre', '#ignored-p']) {
    await expect(page.locator(id)).not.toHaveAttribute('data-khatt', /.*/);
  }
  expect(await fontFamily(page, '#latin')).toBe('Georgia, serif');
  expect(await fontFamily(page, '#inner-latin')).toBe('Verdana, sans-serif');
  expect(await fontFamily(page, '#icon')).toBe('FakeIcons, monospace');
  await page.close();
});

test('handles dynamic content, shadow DOM and iframes', async () => {
  const page = await h.context.newPage();
  await page.goto(`${h.base}/basic`);

  await expect(page.locator('#dynamic')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#latin-later')).toHaveAttribute('data-khatt', /\d+/);

  const shadowed = page.locator('#shadow-host #shadowed');
  await expect(shadowed).toHaveAttribute('data-khatt', /\d+/);
  expect(await shadowed.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Khatt Arabic');

  const framed = page.frameLocator('#frame').locator('#framed');
  await expect(framed).toHaveAttribute('data-khatt', /\d+/);
  expect(await framed.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Khatt Arabic');
  await page.close();
});

test('works on a page with a strict Content-Security-Policy', async () => {
  const page = await h.context.newPage();
  await page.goto(`${h.base}/csp`);

  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  expect(await fontFamily(page, '#arabic')).toContain('Khatt Arabic');
  await khattFontLoaded(page);
  await page.close();
});

test('reverts cleanly when disabled and re-applies when enabled', async () => {
  const page = await h.context.newPage();
  await page.goto(`${h.base}/basic`);
  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);

  await h.setStorage({ global: { enabled: false } });
  await expect(page.locator('[data-khatt]')).toHaveCount(0);
  await expect(page.locator('#khatt-style')).toHaveCount(0);
  expect(await fontFamily(page, '#arabic')).toBe('Georgia, serif');

  await h.setStorage({ global: { enabled: true } });
  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  expect(await fontFamily(page, '#arabic')).toContain('Khatt Arabic');

  // Per-site switch: only this host is turned off.
  await h.setStorage({ 'site:127.0.0.1': { enabled: false } });
  await expect(page.locator('[data-khatt]')).toHaveCount(0);
  await h.removeStorage('site:127.0.0.1');
  await expect(page.locator('#arabic')).toHaveAttribute('data-khatt', /\d+/);
  await page.close();
});
