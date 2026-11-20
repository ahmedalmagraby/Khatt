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

const open = async () => {
  await page.goto(`${h.base}/review3`);
  await expect(page.locator('#pair-b')).toHaveAttribute('data-khatt', /\d+/);
};
const style = (selector: string, prop: string) =>
  page.locator(selector).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const lacks = (selector: string, attr: string) =>
  expect(page.locator(selector)).not.toHaveAttribute(attr, /.*/);

test('a block stays right-to-left when one of two Arabic spans in it turns English', async () => {
  await open();
  await expect(page.locator('#pair')).toHaveAttribute('data-khatt-dir', 'rtl');
  await page.locator('#pair-a').evaluate((el) => {
    (el.firstChild as Text).data = 'Hello';
  });
  await lacks('#pair-a', 'data-khatt');
  // The other span still makes the block mainly Arabic.
  await expect(page.locator('#pair')).toHaveAttribute('data-khatt-dir', 'rtl');
  expect(await style('#pair', 'direction')).toBe('rtl');
});

test('centered Arabic opening with a Latin word is right-to-left and stays centered', async () => {
  await open();
  await expect(page.locator('#center-latin')).toHaveAttribute('data-khatt-dir', 'rtl-bidi');
  expect(await style('#center-latin', 'direction')).toBe('rtl');
  expect(await style('#center-latin', 'text-align')).toBe('center');
  // Opening with Arabic, plaintext alone already reads right-to-left.
  await expect(page.locator('#center-arabic')).toHaveAttribute('data-khatt-dir', 'bidi');
});

test('text that becomes editable gets its original text back before the user edits it', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic', hideTashkeel: true } });
  await open();
  const original = 'كَتَبَ الطالبُ الدرسَ عام 2024 في المدرسة';
  await expect(page.locator('#edit-p')).toHaveText('كتب الطالب الدرس عام ٢٠٢٤ في المدرسة');

  await page.locator('#inline-edit').evaluate((el) => el.setAttribute('contenteditable', 'true'));
  await expect(page.locator('#edit-p')).toHaveText(original);
  await lacks('#edit-p', 'data-khatt');
  await lacks('#edit-p', 'data-khatt-dir');
  await lacks('#edit-p', 'data-khatt-prose');
  // The editor itself still gets the font.
  await expect(page.locator('#inline-edit')).toHaveAttribute('data-khatt', /\d+/);
  // Typing is not rewritten either.
  await page.locator('#edit-p').evaluate((el) => {
    (el.firstChild as Text).data += ' 15';
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('#edit-p')).toHaveText(`${original} 15`);

  // No longer editable: plain page content again.
  await page.locator('#inline-edit').evaluate((el) => el.removeAttribute('contenteditable'));
  await expect(page.locator('#edit-p')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#edit-p')).toHaveText('كتب الطالب الدرس عام ٢٠٢٤ في المدرسة ١٥');
});

test('untagging an outer block leaves the numbers of a tagged inner block converted', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic' } });
  await open();
  await expect(page.locator('#inner-year')).toHaveText('٢٠٢٤');
  await page.locator('#outer').evaluate((el) => {
    (el.firstChild as Text).data = 'Hello ';
  });
  await lacks('#outer', 'data-khatt');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('#inner-year')).toHaveText('٢٠٢٤');
});

test('rewritten text moved into another block makes that block right-to-left', async () => {
  await h.setStorage({ global: { hideTashkeel: true } });
  await open();
  await expect(page.locator('#from')).toHaveAttribute('data-khatt-dir', 'rtl');
  await expect(page.locator('#mover')).toHaveText('كتب الطالب الدرس في المدرسة اليوم');
  await page.evaluate(async () => {
    const mover = document.getElementById('mover')!;
    mover.remove();
    await new Promise(requestAnimationFrame);
    document.getElementById('to')!.append(mover);
  });
  await expect(page.locator('#to')).toHaveAttribute('data-khatt-dir', 'rtl');
});

test('an invalid contenteditable value is not an editor', async () => {
  await h.setStorage({ global: { numerals: 'arabic-indic' } });
  await open();
  await expect(page.locator('#not-editor')).toHaveText('نص عربي عام ٢٠٢٤');
});

test('a page that strips the tag at once, over and over, does not keep Khatt busy', async () => {
  await open();
  await expect(page.locator('#hostile')).toHaveAttribute('data-khatt', /\d+/);
  const added = await page.evaluate(async () => {
    const el = document.getElementById('hostile')!;
    let count = 0;
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.oldValue === null) count++;
        if (el.hasAttribute('data-khatt')) el.removeAttribute('data-khatt');
      }
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-khatt'], attributeOldValue: true });
    el.removeAttribute('data-khatt');
    await new Promise((r) => setTimeout(r, 1500));
    observer.disconnect();
    return count;
  });
  // Re-tagged every frame this would be around 90.
  expect(added).toBeLessThan(30);
});

test('a page that re-renders now and then keeps the font', async () => {
  await open();
  await expect(page.locator('#rerender')).toHaveAttribute('data-khatt', /\d+/);
  await page.evaluate(async () => {
    const el = document.getElementById('rerender')!;
    for (let i = 0; i < 8; i++) {
      el.removeAttribute('data-khatt');
      await new Promise((r) => setTimeout(r, 150));
    }
  });
  await expect(page.locator('#rerender')).toHaveAttribute('data-khatt', /\d+/);
});

test('turning Khatt off and on leaves no marks behind and tags again', async () => {
  await open();
  await h.setStorage({ global: { enabled: false } });
  await expect(page.locator('[data-khatt],[data-khatt-plain],[data-khatt-dir]')).toHaveCount(0);
  await h.setStorage({ global: { enabled: true } });
  await expect(page.locator('#pair-b')).toHaveAttribute('data-khatt', /\d+/);
  await expect(page.locator('#pair')).toHaveAttribute('data-khatt-dir', 'rtl');
});
