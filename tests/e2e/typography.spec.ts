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
  await page.goto(`${h.base}/typo`);
  await expect(page.locator('#ar-p')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#field')).toHaveAttribute('data-khatt', /\d+/);
});

test.afterEach(async () => {
  await page.close();
});

const style = (selector: string, prop: string) =>
  page.locator(selector).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

/** Line height as a multiple of the font size; "normal" is reported as 0. */
const lineRatio = (selector: string) =>
  page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.lineHeight === 'normal' ? 0 : parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
  });

/** Gap between the text and the left/right edge of its element. */
const textGaps = (selector: string) =>
  page.locator(selector).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [...range.getClientRects()];
    const box = el.getBoundingClientRect();
    return {
      left: Math.min(...lines.map((r) => r.left)) - box.left,
      right: box.right - Math.max(...lines.map((r) => r.right)),
    };
  });

test('raises the line height of Arabic prose only where it is too tight', async () => {
  expect(await lineRatio('#ar-p')).toBeCloseTo(1.7, 1);
  // Already taller than the minimum — left as the site set it.
  expect(await lineRatio('#tall')).toBeCloseTo(2.2, 1);
  // Not Arabic, and not prose.
  expect(await lineRatio('#en-p')).toBe(0);
  await expect(page.locator('#btn')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#btn')).not.toHaveAttribute('data-khatt-prose', /.*/);

  await h.setStorage({ global: { lineHeight: 2.4 } });
  await expect.poll(() => lineRatio('#ar-p')).toBeCloseTo(2.4, 1);
  expect(await lineRatio('#tall')).toBeCloseTo(2.4, 1);

  await h.setStorage({ global: { lineHeight: 0 } });
  await expect.poll(() => lineRatio('#ar-p')).toBe(0);
  expect(await lineRatio('#tall')).toBeCloseTo(2.2, 1);
});

test('removes letter-spacing and applies word spacing to Arabic text', async () => {
  expect(await style('#spaced', 'letter-spacing')).toMatch(/^(normal|0px)$/);
  expect(await style('#ar-p', 'word-spacing')).toBe('0px');

  await h.setStorage({ global: { wordSpacing: 0.25 } });
  await expect.poll(() => style('#ar-p', 'word-spacing')).toBe('4px');
  expect(await style('#en-p', 'word-spacing')).toBe('0px');
});

test('right-aligns Arabic paragraphs on an LTR page without touching the rest', async () => {
  await expect(page.locator('#ar-p')).toHaveAttribute('data-khatt-dir', 'auto');
  const arabic = await textGaps('#ar-p');
  expect(arabic.right).toBeLessThan(2);
  expect(arabic.left).toBeGreaterThan(5);

  const english = await textGaps('#en-p');
  expect(english.left).toBeLessThan(2);
  await expect(page.locator('#en-p')).not.toHaveAttribute('data-khatt-dir', /.*/);

  // Text in an inline element fixes the block that lays it out.
  await expect(page.locator('#span-p')).toHaveAttribute('data-khatt-dir', 'auto');
  await expect(page.locator('#sp')).not.toHaveAttribute('data-khatt-dir', /.*/);
  expect((await textGaps('#span-p')).right).toBeLessThan(2);

  // Deliberately aligned text keeps its alignment; only its punctuation order is fixed.
  for (const id of ['#centered', '#btn']) {
    await expect(page.locator(id)).toHaveAttribute('data-khatt-dir', 'bidi');
  }
  expect(await style('#centered', 'text-align')).toBe('center');
  expect(await style('#centered', 'unicode-bidi')).toBe('plaintext');

  // Existing RTL containers and the page itself are left alone.
  for (const id of ['#rtl-p', 'body', 'html']) {
    await expect(page.locator(id)).not.toHaveAttribute('data-khatt-dir', /.*/);
  }
  expect(await style('body', 'direction')).toBe('ltr');
});

test('flips mostly-Arabic lists as a whole and single items individually', async () => {
  await expect(page.locator('#ar-list')).toHaveAttribute('data-khatt-dir', 'rtl');
  expect(await style('#ar-list', 'direction')).toBe('rtl');
  expect(await style('#ar-list > li:first-child', 'direction')).toBe('rtl');

  await expect(page.locator('#en-list')).not.toHaveAttribute('data-khatt-dir', /.*/);
  expect(await style('#en-list', 'direction')).toBe('ltr');
  await expect(page.locator('#ar-li')).toHaveAttribute('data-khatt-dir', 'auto');
  expect((await textGaps('#ar-li')).right).toBeLessThan(2);
});

test('text fields follow the direction of what is typed and use the Arabic font', async () => {
  for (const id of ['#field', '#area']) {
    await expect(page.locator(id)).toHaveAttribute('dir', 'auto');
    expect(await style(id, 'font-family')).toContain('Khatt Arabic');
  }
  await page.locator('#field').fill('مرحبا');
  expect(await style('#field', 'direction')).toBe('rtl');
  await page.locator('#field').fill('hello');
  expect(await style('#field', 'direction')).toBe('ltr');

  // Fields that are LTR by nature, set explicitly, or already in an RTL container keep their direction.
  await expect(page.locator('#email')).not.toHaveAttribute('dir', /.*/);
  await expect(page.locator('#ltr-field')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#rtl-field')).not.toHaveAttribute('dir', /.*/);
  expect(await style('#rtl-field', 'direction')).toBe('rtl');
});

test('direction fixing can be switched off and back on live', async () => {
  await h.setStorage({ global: { fixDirection: false } });
  await expect(page.locator('[data-khatt-dir]')).toHaveCount(0);
  await expect(page.locator('#field')).not.toHaveAttribute('dir', /.*/);
  // Fonts stay on.
  await expect(page.locator('#ar-p')).toHaveAttribute('data-khatt', /\d+/);
  expect((await textGaps('#ar-p')).left).toBeLessThan(2);

  await h.setStorage({ global: { fixDirection: true } });
  await expect(page.locator('#ar-p')).toHaveAttribute('data-khatt-dir', 'auto');
  await expect(page.locator('#field')).toHaveAttribute('dir', 'auto');
});

test('disabling Khatt removes every typography and direction change', async () => {
  await h.setStorage({ global: { enabled: false } });
  await expect(page.locator('[data-khatt],[data-khatt-prose],[data-khatt-dir],[data-khatt-auto-dir]')).toHaveCount(0);
  await expect(page.locator('#field')).not.toHaveAttribute('dir', /.*/);
  await expect(page.locator('#ltr-field')).toHaveAttribute('dir', 'ltr');
  expect(await lineRatio('#ar-p')).toBe(0);
  expect(await style('#spaced', 'letter-spacing')).toBe('3px');
  expect((await textGaps('#ar-p')).left).toBeLessThan(2);
});
