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

const open = async (path = '/review2', ready = '#reused') => {
  await page.goto(`${h.base}${path}`);
  await expect(page.locator(ready)).toHaveAttribute('data-khatt', /\d+/);
};
const style = (selector: string, prop: string) =>
  page.locator(selector).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const has = (selector: string, attr: string) => expect(page.locator(selector)).toHaveAttribute(attr, /.*/);
const lacks = (selector: string, attr: string) =>
  expect(page.locator(selector)).not.toHaveAttribute(attr, /.*/);

test('an element reused for English text is left-to-right again', async () => {
  await open();
  await expect(page.locator('#reused')).toHaveAttribute('data-khatt-dir', 'rtl');
  await page.locator('#reused').evaluate((el) => {
    (el.firstChild as Text).data = 'This element now holds English text only.';
  });
  await lacks('#reused', 'data-khatt');
  await lacks('#reused', 'data-khatt-dir');
  expect(await style('#reused', 'direction')).toBe('ltr');

  // Arabic coming back is handled from scratch, direction included.
  await page.locator('#reused').evaluate((el) => {
    (el.firstChild as Text).data = 'عاد النص العربي إلى العنصر.';
  });
  await expect(page.locator('#reused')).toHaveAttribute('data-khatt-dir', 'rtl');
});

test('controls without Arabic keep their letter spacing until Arabic is typed', async () => {
  await h.setStorage({ global: { wordSpacing: 0.2 } });
  await open();
  for (const id of ['#en-submit', '#en-text', '#en-select']) {
    await has(id, 'data-khatt');
    await has(id, 'data-khatt-plain');
    expect(await style(id, 'letter-spacing')).toBe('2px');
    expect(await style(id, 'word-spacing')).toBe('0px');
  }
  await lacks('#ar-submit', 'data-khatt-plain');
  expect(await style('#ar-submit', 'letter-spacing')).toBe('normal');

  await page.locator('#en-text').fill('مرحبا');
  await lacks('#en-text', 'data-khatt-plain');
  expect(await style('#en-text', 'letter-spacing')).toBe('normal');
  await page.locator('#en-text').fill('hello');
  await has('#en-text', 'data-khatt-plain');
});

test('option text is a form value and is never rewritten', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic', hideTashkeel: true } });
  await open('/review2', '#split');
  await expect(page.locator('#year')).toHaveText('٢٠٢٤');
  expect(await page.locator('#ar-select').evaluate((el) => (el as HTMLSelectElement).value)).toBe('العَرَبِيَّة 2024');
  expect(await page.locator('#list-option').evaluate((el) => (el as HTMLOptionElement).value)).toBe('العَرَبِيَّة 2024');
  await lacks('#ar-option', 'data-khatt');
  await lacks('#list-option', 'data-khatt');
  // The select itself still gets the font.
  expect(await style('#ar-select', 'font-family')).toContain('Khatt Arabic');
});

test('numbers nested in Arabic text follow later changes, and are put back when the text goes', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic' } });
  await open('/review2', '#split');
  await expect(page.locator('#year')).toHaveText('٢٠٢٤');

  // The page updates the number, and adds another one.
  await page.locator('#year').evaluate((el) => {
    (el.firstChild as Text).data = '2025';
  });
  await expect(page.locator('#year')).toHaveText('٢٠٢٥');
  await page.locator('#split').evaluate((el) => {
    el.append(Object.assign(document.createElement('i'), { id: 'added', textContent: '2030' }));
  });
  await expect(page.locator('#added')).toHaveText('٢٠٣٠');

  // The Arabic around a number is replaced with English: the number is Western again.
  await expect(page.locator('#year-reused')).toHaveText('٢٠٢٤');
  await page.locator('#split-reused').evaluate((el) => {
    (el.firstChild as Text).data = 'The year ';
    (el.lastChild as Text).data = ' saw many events';
  });
  await expect(page.locator('#year-reused')).toHaveText('2024');
  await lacks('#split-reused', 'data-khatt');
});

test('an element emptied of its Arabic text loses Khatt’s marks', async () => {
  await open('/review2', '#inner-span');
  await has('#emptied', 'data-khatt-dir');
  await page.locator('#emptied').evaluate((el) => el.replaceChildren());
  await lacks('#emptied', 'data-khatt');
  await lacks('#emptied', 'data-khatt-dir');

  await page.locator('#swapped').evaluate((el) => {
    el.innerHTML = '<span>English text in a new element</span>';
  });
  await lacks('#swapped', 'data-khatt');
  await lacks('#swapped', 'data-khatt-prose');
  await lacks('#swapped', 'data-khatt-dir');
  expect(await style('#swapped', 'direction')).toBe('ltr');

  // The Arabic sat in a child element; the block it had made right-to-left stays behind.
  await has('#inner-gone', 'data-khatt-dir');
  await page.locator('#inner-gone').evaluate((el) => {
    el.innerHTML = '<b>English</b>';
  });
  await lacks('#inner-gone', 'data-khatt-dir');
});

test('a text field added inside a block Khatt flipped still follows what is typed', async () => {
  await open('/review2', '#reply');
  await expect(page.locator('#reply')).toHaveAttribute('data-khatt-dir', 'rtl');
  await page.locator('#reply').evaluate((el) => {
    el.append(Object.assign(document.createElement('input'), { id: 'reply-field', type: 'text' }));
  });
  await expect(page.locator('#reply-field')).toHaveAttribute('dir', 'auto');
  await page.locator('#reply-field').fill('hello');
  expect(await style('#reply-field', 'direction')).toBe('ltr');
});

test('a text field the site makes right-to-left in a late stylesheet gives up its dir="auto"', async () => {
  await open('/late-css', '#late');
  await expect.poll(() => style('#late', 'font-family')).toContain('Verdana');
  await lacks('#late-field', 'dir');
  await lacks('#late-field', 'data-khatt-auto-dir');
  expect(await style('#late-field', 'direction')).toBe('rtl');
  // A field the stylesheet says nothing about keeps following what is typed.
  await expect(page.locator('#late-plain-field')).toHaveAttribute('dir', 'auto');
});

test('lists and blocks are judged by their prose, not their first letter or their styles', async () => {
  await open('/review2', '#with-style');
  await expect(page.locator('#brands')).toHaveAttribute('data-khatt-dir', 'rtl');
  await expect(page.locator('#with-style')).toHaveAttribute('data-khatt-dir', 'rtl');
});

test('an inline dir="auto" wrapper does not flip a block that lays out other blocks', async () => {
  await open('/review2', '#mixed-auto');
  await expect(page.locator('#mixed-auto')).toHaveAttribute('data-khatt-dir', 'rtl-bidi');
  await lacks('#mixed', 'data-khatt-dir');
  expect(await style('#mixed-en', 'direction')).toBe('ltr');
});

test('changing a reading aid or direction fixing never takes the font off the page', async () => {
  await open();
  // Count every time Khatt's tag leaves an element — other than the numbers' own
  // elements, which are only tagged while they hold Arabic-Indic digits.
  await page.evaluate(() => {
    const w = window as unknown as { __untagged: number };
    w.__untagged = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (!el.hasAttribute('data-khatt') && el.localName !== 'b') w.__untagged++;
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-khatt'] });
  });

  await h.setStorage({ global: { numerals: 'arabic-indic' } });
  await expect(page.locator('#year')).toHaveText('٢٠٢٤');
  await h.setStorage({ global: { numerals: 'arabic-indic', fixDirection: false } });
  await expect(page.locator('[data-khatt-dir]')).toHaveCount(0);
  await h.setStorage({ global: { numerals: 'off', fixDirection: true } });
  await expect(page.locator('#year')).toHaveText('2024');
  await expect(page.locator('#reused')).toHaveAttribute('data-khatt-dir', 'rtl');
  await expect(page.locator('#brands')).toHaveAttribute('data-khatt-dir', 'rtl');

  expect(await page.evaluate(() => (window as unknown as { __untagged: number }).__untagged)).toBe(0);
  expect(await style('#reused', 'font-family')).toContain('Khatt Arabic');
});

test('a sandboxed frame follows the settings of the site it is on', async () => {
  await open();
  const framed = page.frameLocator('#sandboxed').locator('#framed');
  await expect(framed).toHaveAttribute('data-khatt', /\d+/);
  // Settings for local files (the empty host) are not this frame's settings.
  await h.setStorage({ 'site:': { enabled: false } });
  await page.waitForTimeout(200);
  await expect(framed).toHaveAttribute('data-khatt', /\d+/);
  // Switching the site off switches its frames off.
  await h.setStorage({ 'site:127.0.0.1': { enabled: false } });
  await expect(framed).not.toHaveAttribute('data-khatt', /.*/);
});

test('the toolbar button’s title is localised', async () => {
  const title = await (await h.worker()).evaluate(
    () => (globalThis as unknown as { chrome: { runtime: { getManifest(): { action: { default_title: string } } } } })
      .chrome.runtime.getManifest().action.default_title,
  );
  expect(title).toBe('Khatt');
  expect(title).not.toContain('__MSG_');
});
