import { buildBackup, parseBackup } from '@/lib/backup';
import { cleanFontName } from '@/lib/css';
import { DEFAULT_FONT_ID, SYSTEM_FONT_ID } from '@/lib/fonts';
import { hasOverrides, resolveSettings, type Settings, type SiteConfig } from '@/lib/settings';
import {
  loadEverything,
  loadRaw,
  loadSites,
  loadSystemFont,
  removeSite,
  replaceEverything,
  setSiteEnabled,
  setSystemFont,
  updateGlobal,
  watchStorage,
} from '@/lib/storage';
import {
  $,
  checkFontCard,
  fontChoices,
  injectPreviewFaces,
  localize,
  renderFontCards,
  t,
} from '@/lib/ui';

/** Local Font Access API — only in some browsers, and only after the user allows it. */
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<{ family: string }[]>;
  }
}

const fontList = $('font-list');
const systemInput = $<HTMLInputElement>('system-font');
const installedFonts = $('installed-fonts');
const loadInstalled = $<HTMLButtonElement>('load-installed');
const systemSample = $('system-sample');
const systemStatus = $('system-status');
const headingFont = $<HTMLSelectElement>('heading-font');
const siteList = $('site-list');
const sitesEmpty = $('sites-empty');
const importFile = $<HTMLInputElement>('import-file');
const backupStatus = $('backup-status');

let global: Partial<Settings> = {};
let systemFont = '';
let sites: { hostname: string; config: SiteConfig }[] = [];
let renderedChoices = '';

function status(el: HTMLElement, message: string, error = false): void {
  el.textContent = message;
  el.classList.toggle('error', error);
}

function render(): void {
  const settings = resolveSettings(global);
  const choices = fontChoices(systemFont);

  // Rebuild the pickers only when the set of fonts changes (the system font came or went).
  const signature = choices.map((c) => c.id + c.label).join('|');
  if (signature !== renderedChoices) {
    renderedChoices = signature;
    renderFontCards(fontList, choices, t('sampleTextLong'), (id) => void save({ fontId: id }));
    headingFont.replaceChildren(
      new Option(t('headingFontSame'), ''),
      ...choices.map((c) => new Option(c.label, c.id)),
    );
  }
  checkFontCard(fontList, settings.fontId);
  headingFont.value = choices.some((c) => c.id === settings.headingFontId)
    ? settings.headingFontId
    : '';

  if (document.activeElement !== systemInput) systemInput.value = systemFont;
  showSystemSample(systemInput.value);

  siteList.replaceChildren(...sites.map(siteRow));
  sitesEmpty.hidden = sites.length > 0;
}

function showSystemSample(name: string): void {
  const clean = cleanFontName(name);
  systemSample.hidden = !clean;
  systemSample.textContent = t('sampleTextLong');
  systemSample.style.fontFamily = clean ? `"${clean}", sans-serif` : '';
}

function siteRow({ hostname, config }: { hostname: string; config: SiteConfig }): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.host = hostname;

  const host = document.createElement('span');
  host.className = 'host';
  host.dir = 'ltr';
  host.textContent = hostname;
  li.append(host);

  const badge = (key: string) => {
    const el = document.createElement('span');
    el.className = 'badge';
    el.textContent = t(key);
    li.append(el);
  };
  const button = (key: string, action: string, run: () => Promise<void>) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.action = action;
    el.textContent = t(key);
    el.addEventListener('click', () => void commit(run));
    li.append(el);
  };

  if (config.enabled === false) badge('siteOff');
  if (hasOverrides(config)) badge('siteCustom');
  if (config.enabled === false) button('siteTurnOn', 'enable', () => setSiteEnabled(hostname, true));
  button('siteForget', 'forget', () => removeSite(hostname));
  return li;
}

async function reload(): Promise<void> {
  try {
    const [raw, font, list] = await Promise.all([loadRaw(null), loadSystemFont(), loadSites()]);
    global = raw.global;
    systemFont = font;
    sites = list;
    render();
  } catch (err) {
    console.error('[Khatt] could not load settings', err);
  }
}

/** Runs a storage write, then re-reads so the page always shows what is stored. */
async function commit(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error('[Khatt] could not save settings', err);
  }
  await reload();
}

const save = (patch: Partial<Settings>) => commit(() => updateGlobal(patch));

async function listInstalledFonts(): Promise<void> {
  try {
    const fonts = (await window.queryLocalFonts?.()) ?? [];
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    installedFonts.replaceChildren(...families.map((family) => new Option(family, family)));
    status(
      systemStatus,
      families.length ? t('systemFontLoaded', String(families.length)) : t('systemFontDenied'),
      families.length === 0,
    );
  } catch {
    status(systemStatus, t('systemFontDenied'), true);
  }
}

async function exportSettings(): Promise<void> {
  try {
    const backup = buildBackup(await loadEverything());
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    );
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: 'khatt-settings.json',
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(backupStatus, t('backupExported'));
  } catch (err) {
    console.error('[Khatt] export failed', err);
    status(backupStatus, t('backupFailed'), true);
  }
}

async function importSettings(file: File): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = parseBackup(await file.text());
  } catch {
    status(backupStatus, t('backupInvalid'), true);
    return;
  }
  if (!window.confirm(t('backupConfirm'))) return;
  try {
    await replaceEverything(data);
    status(backupStatus, t('backupImported'));
  } catch (err) {
    console.error('[Khatt] import failed', err);
    status(backupStatus, t('backupFailed'), true);
  }
  await reload();
}

function bind(): void {
  headingFont.addEventListener('change', () => void save({ headingFontId: headingFont.value }));

  systemInput.addEventListener('input', () => showSystemSample(systemInput.value));

  $('use-system').addEventListener('click', () => {
    const name = cleanFontName(systemInput.value);
    if (!name) {
      status(systemStatus, t('systemFontEmpty'), true);
      return;
    }
    status(systemStatus, '');
    void commit(async () => {
      await setSystemFont(name);
      await updateGlobal({ fontId: SYSTEM_FONT_ID });
    });
  });

  $('clear-system').addEventListener('click', () => {
    systemInput.value = '';
    status(systemStatus, '');
    void commit(async () => {
      await setSystemFont('');
      // Don't leave settings pointing at a font that is no longer named.
      const patch: Partial<Settings> = {};
      if (global.fontId === SYSTEM_FONT_ID) patch.fontId = DEFAULT_FONT_ID;
      if (global.headingFontId === SYSTEM_FONT_ID) patch.headingFontId = '';
      if (Object.keys(patch).length) await updateGlobal(patch);
    });
  });

  loadInstalled.hidden = typeof window.queryLocalFonts !== 'function';
  loadInstalled.addEventListener('click', () => void listInstalledFonts());

  $('export').addEventListener('click', () => void exportSettings());
  $('import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (file) void importSettings(file);
  });
}

async function init(): Promise<void> {
  localize();
  document.title = t('optionsTitle');
  injectPreviewFaces();
  bind();
  await reload();
  watchStorage('*', () => void reload());
}

void init();
