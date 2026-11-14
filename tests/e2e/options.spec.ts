import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, type Harness } from './harness';

let h: Harness;
let site: Page;
let options: Page;

test.beforeAll(async () => {
  h = await launch();
});

test.afterAll(async () => {
  await h?.close();
});

test.beforeEach(async () => {
  await h.clearStorage();
  await h.setLocal({ systemFont: '' });
  site = await h.context.newPage();
  await site.goto(`${h.base}/extras`);
  await expect(site.locator('#tash')).toHaveAttribute('data-khatt', /\d+/);
  options = await h.context.newPage();
  await options.goto(`chrome-extension://${h.extensionId}/options.html`);
  await expect(options.locator('#font-list input')).toHaveCount(8);
});

test.afterEach(async () => {
  await options.close();
  await site.close();
});

const siteCss = () => site.locator('#khatt-style').evaluate((el) => el.textContent ?? '');
const fontFamily = (selector: string) =>
  site.locator(selector).evaluate((el) => getComputedStyle(el).fontFamily);

test('lists every bundled font and applies the chosen one', async () => {
  await expect(options.locator('input[name="font"][value="ibm-plex-sans-arabic"]')).toBeChecked();
  await options.waitForFunction(
    () => [...document.fonts].filter((f) => f.status === 'loaded').length >= 8,
  );

  await options.locator('input[name="font"][value="amiri"]').check();
  await expect.poll(siteCss).toContain('amiri-400.woff2');
  expect((await h.getStorage()).global).toMatchObject({ fontId: 'amiri' });
});

test('a font installed on the computer can be used, and cleared', async () => {
  await options.locator('#system-font').fill('Tahoma');
  await expect(options.locator('#system-sample')).toBeVisible();
  await options.locator('#use-system').click();

  await expect.poll(siteCss).toContain('src:local("Tahoma")');
  expect((await h.getStorage()).global).toMatchObject({ fontId: 'system' });
  expect(await h.getLocal()).toMatchObject({ systemFont: 'Tahoma' });
  // It becomes a selectable font, here and as a heading font.
  await expect(options.locator('input[name="font"][value="system"]')).toBeChecked();
  await expect(options.locator('#heading-font option[value="system"]')).toHaveText('Tahoma');
  expect(await fontFamily('#tash')).toContain('Khatt Arabic');

  await options.locator('#clear-system').click();
  await expect(options.locator('input[name="font"][value="system"]')).toHaveCount(0);
  await expect.poll(siteCss).toContain('ibm-plex-sans-arabic-400.woff2');
  expect(await siteCss()).not.toContain('local(');
  expect(await h.getLocal()).not.toHaveProperty('systemFont');
});

test('an empty installed-font name is refused', async () => {
  await options.locator('#use-system').click();
  await expect(options.locator('#system-status')).toHaveClass(/error/);
  expect(await h.getStorage()).not.toHaveProperty('global');
});

test('a separate heading font applies inside headings only', async () => {
  expect(await fontFamily('#heading')).toMatch(/^"Khatt Arabic", /);

  await options.locator('#heading-font').selectOption('noto-kufi-arabic');
  await expect.poll(() => fontFamily('#heading')).toMatch(/^"Khatt Arabic Heading", /);
  expect(await fontFamily('#tash')).toMatch(/^"Khatt Arabic", /);
  const css = await siteCss();
  expect(css).toContain('noto-kufi-arabic.woff2');
  expect(css).toContain('ibm-plex-sans-arabic-400.woff2');

  await options.locator('#heading-font').selectOption('');
  await expect.poll(() => fontFamily('#heading')).toMatch(/^"Khatt Arabic", /);
  expect(await siteCss()).not.toContain('noto-kufi-arabic.woff2');
});

test('lists sites with their own settings and can reset them', async () => {
  await expect(options.locator('#sites-empty')).toBeVisible();

  await h.setStorage({
    'site:off.example': { enabled: false },
    'site:custom.example': { overrides: { fontId: 'amiri' } },
  });
  await expect(options.locator('#site-list li')).toHaveCount(2);
  await expect(options.locator('#sites-empty')).toBeHidden();
  const off = options.locator('li[data-host="off.example"]');
  const custom = options.locator('li[data-host="custom.example"]');
  await expect(off.locator('.badge')).toHaveText('Off');
  await expect(custom.locator('.badge')).toHaveText('Custom settings');
  await expect(custom.locator('button[data-action="enable"]')).toHaveCount(0);

  await off.locator('button[data-action="enable"]').click();
  await expect(options.locator('#site-list li')).toHaveCount(1);
  expect(await h.getStorage()).not.toHaveProperty(['site:off.example']);

  await custom.locator('button[data-action="forget"]').click();
  await expect(options.locator('#sites-empty')).toBeVisible();
  expect(await h.getStorage()).not.toHaveProperty(['site:custom.example']);
});

test('exports settings to a file and imports them back', async () => {
  await h.setStorage({
    global: { fontId: 'vazirmatn', hideTashkeel: true },
    'site:off.example': { enabled: false },
  });
  const [download] = await Promise.all([
    options.waitForEvent('download'),
    options.locator('#export').click(),
  ]);
  expect(download.suggestedFilename()).toBe('khatt-settings.json');
  const exported = readFileSync(await download.path(), 'utf8');
  expect(JSON.parse(exported)).toMatchObject({
    app: 'khatt',
    data: { global: { fontId: 'vazirmatn', hideTashkeel: true }, 'site:off.example': { enabled: false } },
  });

  // Change everything, then restore from the file.
  await h.clearStorage();
  await h.setStorage({ global: { fontId: 'amiri' }, 'site:other.example': { enabled: false } });
  options.once('dialog', (dialog) => void dialog.accept());
  await options.locator('#import-file').setInputFiles({
    name: 'khatt-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported),
  });
  await expect(options.locator('#backup-status')).toHaveText('Settings imported.');
  const stored = await h.getStorage();
  expect(stored.global).toEqual({ fontId: 'vazirmatn', hideTashkeel: true });
  expect(stored).toHaveProperty(['site:off.example']);
  expect(stored).not.toHaveProperty(['site:other.example']);
  await expect(options.locator('input[name="font"][value="vazirmatn"]')).toBeChecked();
});

test('refuses a file that is not a Khatt backup and changes nothing', async () => {
  await h.setStorage({ global: { fontId: 'amiri' } });
  await options.locator('#import-file').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  });
  await expect(options.locator('#backup-status')).toHaveText(
    'That file is not a Khatt settings file.',
  );
  await expect(options.locator('#backup-status')).toHaveClass(/error/);
  expect((await h.getStorage()).global).toEqual({ fontId: 'amiri' });
});
