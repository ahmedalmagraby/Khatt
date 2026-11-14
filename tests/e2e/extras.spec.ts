import { expect, test, type Page } from '@playwright/test';
import { launch, type Harness } from './harness';

let h: Harness;
let page: Page;

const TASH = 'العَرَبِيَّةُ لُغَةٌ جَمِيلَةٌ';
const NUM = 'عام 2024 شهد 15 حدثا';
const INDIC = 'عام ٢٠٢٤ و ۱۴۰۳';
const DYN = 'نَصٌّ أُضِيفَ لاحِقًا 7';

test.beforeAll(async () => {
  h = await launch();
});

test.afterAll(async () => {
  await h?.close();
});

test.beforeEach(async () => {
  await h.clearStorage();
  page = await h.context.newPage();
  await page.goto(`${h.base}/extras`);
  await expect(page.locator('#dyn')).toHaveAttribute('data-khatt', /\d+/);
});

test.afterEach(async () => {
  await page.close();
});

const text = (selector: string) => page.locator(selector).evaluate((el) => el.textContent);

test('nothing is rewritten by default', async () => {
  expect(await text('#tash')).toBe(TASH);
  expect(await text('#num')).toBe(NUM);
  expect(await text('#indic')).toBe(INDIC);
});

test('hides tashkeel and restores the exact original text', async () => {
  await h.setStorage({ global: { hideTashkeel: true } });
  await expect(page.locator('#tash')).toHaveText('العربية لغة جميلة');
  await expect(page.locator('#dyn')).toHaveText('نص أضيف لاحقا 7');

  // Code, text fields and editable regions are never rewritten.
  expect(await text('#pre')).toBe('كَتَبَ 123');
  expect(await page.locator('#area').inputValue()).toBe('نَصٌّ 123');
  expect(await text('#edit')).toBe('نَصٌّ 123');

  await h.setStorage({ global: { hideTashkeel: false } });
  await expect.poll(() => text('#tash')).toBe(TASH);
  expect(await text('#dyn')).toBe(DYN);
});

test('converts numerals inside Arabic text in either direction', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic' } });
  await expect(page.locator('#num')).toHaveText('عام ٢٠٢٤ شهد ١٥ حدثا');
  expect(await text('#latin-num')).toBe('Year 2024 only');
  expect(await text('#indic')).toBe(INDIC);

  await h.setStorage({ global: { numerals: 'western' } });
  await expect(page.locator('#indic')).toHaveText('عام 2024 و 1403');
  await expect.poll(() => text('#num')).toBe(NUM);

  await h.setStorage({ global: { numerals: 'off' } });
  await expect.poll(() => text('#indic')).toBe(INDIC);
  expect(await text('#num')).toBe(NUM);
});

test('combines both rewrites and keeps up with text the page changes later', async () => {
  await h.setStorage({ global: { hideTashkeel: true, numerals: 'arabic-indic' } });
  await expect(page.locator('#dyn')).toHaveText('نص أضيف لاحقا ٧');

  // The page replaces text in an element Khatt already handled.
  await page.locator('#num').evaluate((el) => {
    (el.firstChild as Text).data = 'سِعْرُ 99';
  });
  await expect(page.locator('#num')).toHaveText('سعر ٩٩');

  // Switching off restores the page's latest text, not the stale one.
  await h.setStorage({ global: {} });
  await expect.poll(() => text('#num')).toBe('سِعْرُ 99');
  expect(await text('#dyn')).toBe(DYN);
});

test('disabling Khatt puts all rewritten text back', async () => {
  await h.setStorage({ global: { hideTashkeel: true, numerals: 'arabic-indic' } });
  await expect(page.locator('#tash')).toHaveText('العربية لغة جميلة');

  await h.setStorage({ 'site:127.0.0.1': { enabled: false } });
  await expect.poll(() => text('#tash')).toBe(TASH);
  expect(await text('#num')).toBe(NUM);
  await expect(page.locator('[data-khatt]')).toHaveCount(0);
});

test('justifies Arabic paragraphs but respects deliberate alignment', async () => {
  const align = (selector: string) =>
    page.locator(selector).evaluate((el) => getComputedStyle(el).textAlign);
  expect(await align('#long')).toBe('start');

  await h.setStorage({ global: { justify: true } });
  await expect.poll(() => align('#long')).toBe('justify');
  expect(await align('#centered-long')).toBe('center');
  expect(await align('#latin-num')).toBe('start');

  await h.setStorage({ global: { justify: false } });
  await expect.poll(() => align('#long')).toBe('start');
});
