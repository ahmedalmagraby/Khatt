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
  await page.goto(`${h.base}/dirauto`);
  await expect(page.locator('#post-span')).toHaveAttribute('data-khatt', /\d+/);
});

test.afterEach(async () => {
  await page.close();
});

const style = (selector: string, prop: string) =>
  page.locator(selector).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const mark = (selector: string) => page.locator(selector).getAttribute('data-khatt-dir');

/** Gap between the text and the left/right edge of its element, per line (worst case). */
const gaps = (selector: string) =>
  page.locator(selector).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0);
    const box = el.getBoundingClientRect();
    return {
      left: Math.round(Math.min(...lines.map((r) => r.left)) - box.left),
      // The largest distance any line ends from the right edge: 0 when every line is right-aligned.
      rightWorst: Math.round(Math.max(...Object.values(
        lines.reduce<Record<number, number>>((byLine, r) => {
          const key = Math.round(r.top);
          byLine[key] = Math.max(byLine[key] ?? -Infinity, r.right);
          return byLine;
        }, {}),
      ).map((right) => box.right - right))),
    };
  });

test('a mainly Arabic post marked dir="auto" that opens with a Latin word becomes right-to-left', async () => {
  // Without Khatt the browser's guess is left-to-right; with it, the whole post is right-to-left.
  expect(await mark('#post')).toBe('rtl');
  expect(await style('#post', 'direction')).toBe('rtl');
  // Every line — including the ones starting with "Claude", "•" and "/btw" — ends at the right edge.
  expect((await gaps('#post')).rightWorst).toBeLessThan(2);

  // The original complaint, checked directly: the first line starts at the right with "Claude".
  const claudeAtRight = await page.locator('#post-span').evaluate((span) => {
    const node = span.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 6); // "Claude"
    const word = range.getBoundingClientRect();
    const box = span.parentElement!.getBoundingClientRect();
    return Math.round(box.right - word.right);
  });
  expect(claudeAtRight).toBeLessThan(2);
});

test('leaves alone dir="auto" text the browser already gets right', async () => {
  // Opens with Arabic: already right-to-left by the browser's own guess.
  expect(await mark('#post-ok')).toBeNull();
  expect(await style('#post-ok', 'direction')).toBe('rtl');
  // Mostly English: left-to-right is correct.
  expect(await mark('#post-en')).toBeNull();
  expect(await style('#post-en', 'direction')).toBe('ltr');
  expect((await gaps('#post-en')).left).toBeLessThan(2);
});

test('respects an explicit dir="ltr"', async () => {
  expect(await mark('#forced-ltr')).toBeNull();
  expect(await style('#forced-ltr', 'direction')).toBe('ltr');
  await expect(page.locator('#forced-ltr')).toHaveAttribute('data-khatt', /\d+/);
});

test('handles dir="auto" on an inline wrapper together with its block', async () => {
  expect(await mark('#wrap')).toBe('rtl');
  expect(await mark('#inline-auto')).toBe('rtl-bidi');
  expect(await style('#inline-auto', 'direction')).toBe('rtl');
  expect((await gaps('#wrap')).rightWorst).toBeLessThan(2);
});

test('respects an explicit dir on an inline wrapper, so a chat bubble’s text stays clear of its time', async () => {
  await expect(page.locator('#bubble-text')).toHaveAttribute('data-khatt', /\d+/);
  expect(await mark('#bubble-line')).toBeNull();
  expect(await style('#bubble-line', 'direction')).toBe('ltr');
  // The spacer stays after the text, under the time, so the two do not overlap.
  const { textRight, timeLeft } = await page.evaluate(() => ({
    textRight: document.getElementById('bubble-text')!.getBoundingClientRect().right,
    timeLeft: document.getElementById('bubble-time')!.getBoundingClientRect().left,
  }));
  expect(textRight).toBeLessThanOrEqual(timeLeft + 1);
});

test('keeps deliberate alignment while fixing direction', async () => {
  expect(await mark('#post-center')).toBe('rtl-bidi');
  expect(await style('#post-center', 'direction')).toBe('rtl');
  expect(await style('#post-center', 'text-align')).toBe('center');
});

test('a plain mainly Arabic paragraph is right-to-left as a whole, a container of blocks is not', async () => {
  expect(await mark('#plain')).toBe('rtl');
  // The first line starts with "Chrome" and is still right-aligned.
  expect((await gaps('#plain')).rightWorst).toBeLessThan(2);

  // Direction is inherited, so a block that holds other blocks only gets per-paragraph fixing.
  expect(await mark('#container')).toBe('auto');
  expect(await style('#inner-en', 'direction')).toBe('ltr');
  expect((await gaps('#inner-en')).left).toBeLessThan(2);
});

test('switching direction fixing off, or Khatt off, restores the page’s own direction', async () => {
  await h.setStorage({ global: { fixDirection: false } });
  await expect(page.locator('[data-khatt-dir]')).toHaveCount(0);
  expect(await style('#post', 'direction')).toBe('ltr');
  await expect(page.locator('#post')).toHaveAttribute('dir', 'auto');

  await h.setStorage({ global: { fixDirection: true } });
  await expect(page.locator('#post')).toHaveAttribute('data-khatt-dir', 'rtl');

  await h.setStorage({ global: { enabled: false } });
  await expect(page.locator('[data-khatt-dir]')).toHaveCount(0);
  expect(await style('#post', 'direction')).toBe('ltr');
});
