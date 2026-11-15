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
const text = (selector: string) => page.locator(selector).evaluate((el) => el.textContent);
const untouched = (selector: string) =>
  expect(page.locator(selector)).not.toHaveAttribute('data-khatt', /.*/);

test('a byte-order mark in English text is not mistaken for Arabic', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic', justify: true } });
  await open('/review', '#reused');
  await untouched('#bom');
  expect(await text('#bom')).toContain('2024');
  expect(await style('#bom', 'text-align')).toBe('start');
});

test('re-reads the page’s styles when a stylesheet arrives after tagging', async () => {
  await open('/late-css', '#late');
  // The stylesheet is delayed; by now the element was tagged under the browser's defaults.
  await expect.poll(() => style('#late', 'font-family')).toMatch(/^"Khatt Arabic", Verdana, sans-serif$/);
  // Its own line height (2.6) is above the minimum and is kept.
  const ratio = await page.locator('#late').evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
  });
  expect(ratio).toBeCloseTo(2.6, 1);
  // Text the late stylesheet centers stays centered; only its punctuation order is fixed.
  await expect(page.locator('#late-center')).toHaveAttribute('data-khatt-dir', 'bidi');
  expect(await style('#late-center', 'text-align')).toBe('center');
  // And text it makes right-to-left is no longer forced.
  await expect(page.locator('#late-rtl')).not.toHaveAttribute('data-khatt-dir', /.*/);
  expect(await style('#late-rtl', 'direction')).toBe('rtl');
});

test('style and script inside SVG are never rewritten; SVG text gets the font only', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic', hideTashkeel: true } });
  await open('/review', '#svg-text');
  expect(await text('#svg-style')).toBe('/* عنوان 2024 */ .a { stroke-width: 2px; }');
  await untouched('#svg-style');
  expect(await style('#svg-text', 'font-family')).toContain('Khatt Arabic');
  await expect(page.locator('#svg-text')).not.toHaveAttribute('data-khatt-prose', /.*/);
  await expect(page.locator('#svg [data-khatt-dir]')).toHaveCount(0);
});

test('selects, button inputs and placeholders get the font', async () => {
  await open('/review', '#reused');
  for (const id of ['#sel', '#submit', '#email']) {
    await expect(page.locator(id)).toHaveAttribute('data-khatt', /\d+/);
    expect(await style(id, 'font-family')).toContain('Khatt Arabic');
  }
  // Only free-text fields follow the typed direction.
  await expect(page.locator('#email')).not.toHaveAttribute('dir', /.*/);
  await expect(page.locator('#submit')).not.toHaveAttribute('dir', /.*/);
  await untouched('#checkbox');
});

test('an element whose Arabic text is replaced with English loses Khatt’s marks', async () => {
  await h.setStorage({ global: { justify: true, hideTashkeel: true } });
  await open('/review', '#reused');
  await expect(page.locator('#reused')).toHaveAttribute('data-khatt-prose', /\d+/);

  await page.locator('#reused').evaluate((el) => {
    (el.firstChild as Text).data = 'This element now holds English text only, reused in place by the page.';
  });
  await untouched('#reused');
  await expect(page.locator('#reused')).not.toHaveAttribute('data-khatt-prose', /.*/);
  await expect(page.locator('#reused')).not.toHaveAttribute('data-khatt-justify', /.*/);
  expect(await style('#reused', 'font-family')).toBe('Georgia, serif');
  expect(await style('#reused', 'text-align')).toBe('start');
  // "start" alone would also be true of a block still forced right-to-left.
  expect(await style('#reused', 'direction')).toBe('ltr');

  // And it is picked up again if Arabic comes back.
  await page.locator('#reused').evaluate((el) => {
    (el.firstChild as Text).data = 'عاد النص العربي إلى العنصر.';
  });
  await expect(page.locator('#reused')).toHaveAttribute('data-khatt', /\d+/);
});

test('only blocks that are mainly Arabic are re-aligned', async () => {
  await open('/review', '#lang-ar');
  // The Arabic link has the font, but the row of links and the English sentence keep their direction.
  await expect(page.locator('#langs')).not.toHaveAttribute('data-khatt-dir', /.*/);
  await expect(page.locator('#quote')).not.toHaveAttribute('data-khatt-dir', /.*/);
  const left = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return Math.round(range.getClientRects()[0]!.left - el.getBoundingClientRect().left);
    });
  expect(await left('#langs')).toBeLessThan(2);
  expect(await left('#quote')).toBeLessThan(2);
  // A mainly Arabic paragraph is still handled, even when it opens with a Latin word.
  await expect(page.locator('#mostly-ar')).toHaveAttribute('data-khatt-dir', 'rtl');
});

test('a flipped list is judged again as its items change', async () => {
  await open('/review', '#shrinking li');
  await expect(page.locator('#shrinking')).toHaveAttribute('data-khatt-dir', 'rtl');

  await page.locator('#shrinking').evaluate((list) => {
    for (const label of ['One', 'Two', 'Three', 'Four']) {
      list.append(Object.assign(document.createElement('li'), { textContent: label }));
    }
  });
  await expect(page.locator('#shrinking')).not.toHaveAttribute('data-khatt-dir', /.*/);
  expect(await style('#shrinking', 'direction')).toBe('ltr');
  // Its one Arabic item is now handled on its own.
  await expect(page.locator('#shrinking li').first()).toHaveAttribute('data-khatt-dir', 'auto');

  // A list that starts with an English item and then fills with Arabic ones is flipped.
  await page.locator('#growing').evaluate((list) => {
    for (const label of ['الأول', 'الثاني', 'الثالث']) {
      list.append(Object.assign(document.createElement('li'), { textContent: label }));
    }
  });
  await expect(page.locator('#growing')).toHaveAttribute('data-khatt-dir', 'rtl');
});

test('numeral conversion reaches numbers in their own element and skips technical tokens', async () => {
  await open('/review', '#split');
  await h.setStorage({ global: { numerals: 'arabic-indic' } });
  await expect(page.locator('#year')).toHaveText('٢٠٢٤');
  await expect(page.locator('#count')).toHaveText('١٥');
  await expect(page.locator('#tech')).toHaveText('الإصدار v2.4.1 متاح على https://example.com/2026 منذ ٢٠٢٦');
  // Numbers in English text stay as they are.
  expect(await text('#bom')).toContain('2024');
  expect(await text('#quote')).toContain('Middle East');

  await h.setStorage({ global: { numerals: 'off' } });
  await expect(page.locator('#year')).toHaveText('2024');
  await expect(page.locator('#count')).toHaveText('15');
  await expect(page.locator('#tech')).toHaveText('الإصدار v2.4.1 متاح على https://example.com/2026 منذ 2026');
});

test('puts its stylesheet back if the page removes it', async () => {
  await open('/review', '#reused');
  await page.evaluate(() => document.getElementById('khatt-style')!.remove());
  // Any later change on the page triggers the check.
  await page.evaluate(() => document.body.append(document.createElement('span')));
  await expect(page.locator('#khatt-style')).toHaveCount(1);
  expect(await style('#reused', 'font-family')).toContain('Khatt Arabic');
});

test.describe('popup and options', () => {
  let ext: Page;

  test.afterEach(async () => {
    await ext?.close();
  });

  const openPopup = async () => {
    ext = await h.context.newPage();
    await ext.goto(`chrome-extension://${h.extensionId}/popup.html?host=127.0.0.1`);
    await expect(ext.locator('#host')).toHaveText('127.0.0.1');
  };
  const openOptions = async () => {
    ext = await h.context.newPage();
    await ext.goto(`chrome-extension://${h.extensionId}/options.html`);
    await expect(ext.locator('#font-list input')).toHaveCount(8);
  };

  test('switching Khatt off takes the popup’s controls out of reach, not just out of sight', async () => {
    await openPopup();
    expect(await ext.locator('#controls').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
    await ext.locator('#master').uncheck();
    await expect.poll(() => ext.locator('#controls').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
    await ext.locator('#master').check();
    await expect.poll(() => ext.locator('#controls').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  });

  test('switches are labelled once, by their visible text, which also toggles them', async () => {
    await openPopup();
    await ext.locator('#fine-tuning summary').click();
    const direction = ext.getByRole('switch', { name: 'Fix text direction' });
    await expect(direction).toHaveCount(1);
    await expect(direction).toHaveAccessibleDescription(/Right-align Arabic text/);
    await expect(direction).toBeChecked();
    await ext.locator('label[for="fix-direction"]').click();
    await expect(direction).not.toBeChecked();
    await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ fixDirection: false });
    await expect(ext.getByRole('switch', { name: 'Enabled on this site' })).toHaveCount(1);
  });

  test('a system-font choice with no font named on this device shows the default as selected', async () => {
    await h.setLocal({ systemFont: '' });
    await h.setStorage({ global: { fontId: 'system' } });
    await openPopup();
    await expect(ext.locator('input[name="font"][value="ibm-plex-sans-arabic"]')).toBeChecked();
    await ext.close();
    await openOptions();
    await expect(ext.locator('input[name="font"][value="ibm-plex-sans-arabic"]')).toBeChecked();
  });

  test('the font list does not jump back when another control changes', async () => {
    await openPopup();
    const list = ext.locator('#font-list');
    await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const scrolled = await list.evaluate((el) => el.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    await ext.locator('#size').fill('110');
    await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ sizeAdjust: 110 });
    await ext.waitForTimeout(200);
    expect(await list.evaluate((el) => el.scrollTop)).toBe(scrolled);
  });

  test('a slider value is saved the moment the drag ends', async () => {
    await openPopup();
    // `change` fires on release; nothing waits for the debounce.
    await ext.locator('#size').evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '125';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(async () => (await h.getStorage()).global, { timeout: 1000, intervals: [20] }).toMatchObject({ sizeAdjust: 125 });
  });

  test('options: Enter applies the installed font, and clearing it also resets sites that used it', async () => {
    await h.setLocal({ systemFont: '' });
    await openOptions();
    await expect(ext.getByRole('combobox', { name: 'Font installed on this computer' })).toHaveCount(1);
    await ext.locator('#system-font').fill('Tahoma');
    await ext.locator('#system-font').press('Enter');
    await expect.poll(() => h.getLocal()).toMatchObject({ systemFont: 'Tahoma' });
    await expect.poll(async () => (await h.getStorage()).global).toMatchObject({ fontId: 'system' });

    await h.setStorage({
      'site:a.example': { overrides: { fontId: 'system', sizeAdjust: 110 } },
      'site:b.example': { overrides: { headingFontId: 'system' } },
    });
    await expect(ext.locator('#site-list li')).toHaveCount(2);
    // Each row's buttons say which site they act on.
    await expect(ext.getByRole('button', { name: 'Reset: a.example' })).toHaveCount(1);
    await expect(ext.locator('#site-list')).toHaveAttribute('role', 'list');

    await ext.locator('#clear-system').click();
    await expect.poll(() => h.getStorage()).toMatchObject({
      global: { fontId: 'ibm-plex-sans-arabic' },
      'site:a.example': { overrides: { sizeAdjust: 110 } },
    });
    const stored = await h.getStorage();
    expect(stored['site:a.example']).toEqual({ overrides: { sizeAdjust: 110 } });
    expect(stored).not.toHaveProperty(['site:b.example']);
  });
});
