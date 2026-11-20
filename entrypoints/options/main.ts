import { buildBackup, parseBackup } from '@/lib/backup';
import { cleanFontName, systemBoldSources } from '@/lib/css';
import { DEFAULT_FONT_ID, effectiveFontId, SYSTEM_FONT_ID } from '@/lib/fonts';
import { hasOverrides, resolveSettings, type Settings, type SiteConfig } from '@/lib/settings';
import {
  loadEverything,
  loadRaw,
  loadSites,
  loadSystemFont,
  removeSite,
  removeSiteOverrideKeys,
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
  isFontInstalled,
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
const importDialog = $<HTMLDialogElement>('import-dialog');
const backupStatus = $('backup-status');

let global: Partial<Settings> = {};
let systemFont = '';
let sites: { hostname: string; config: SiteConfig }[] = [];
let renderedChoices = '';
/** Installed font families, once the user has asked for them to be listed. */
let families: string[] = [];
/** The suggestion the arrow keys are on; -1 = none. */
let activeOption = -1;

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
  checkFontCard(fontList, effectiveFontId(settings.fontId, systemFont));
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
  host.textContent = hostname || t('localFiles');
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
    // Every row has the same buttons; the name says which site this one acts on.
    el.setAttribute('aria-label', `${t(key)}: ${hostname || t('localFiles')}`);
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

/**
 * Runs a storage write. A successful write comes back through the storage listener,
 * which re-renders; only a failed one needs re-reading here, to undo the control.
 */
async function commit(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error('[Khatt] could not save settings', err);
    await reload();
  }
}

/** Asks before replacing all settings. Resolves true only on an explicit yes. */
function confirmImport(): Promise<boolean> {
  return new Promise((resolve) => {
    importDialog.returnValue = '';
    importDialog.addEventListener('close', () => resolve(importDialog.returnValue === 'confirm'), {
      once: true,
    });
    importDialog.showModal();
  });
}

const save = (patch: Partial<Settings>) => commit(() => updateGlobal(patch));

/** The suggestions currently shown under the font-name field. */
const suggestions = () => [...installedFonts.querySelectorAll<HTMLElement>('[role="option"]')];

function closeSuggestions(): void {
  installedFonts.hidden = true;
  activeOption = -1;
  systemInput.setAttribute('aria-expanded', 'false');
  systemInput.removeAttribute('aria-activedescendant');
}

/** Shows the installed fonts whose name contains what is typed, each with a sample in that font. */
function showSuggestions(): void {
  const query = systemInput.value.trim().toLowerCase();
  const matches = query ? families.filter((f) => f.toLowerCase().includes(query)) : families;
  // Nothing to offer, or the one match is already what is typed.
  if (matches.length === 0 || (matches.length === 1 && matches[0]!.toLowerCase() === query)) {
    closeSuggestions();
    return;
  }
  installedFonts.replaceChildren(
    ...matches.map((family, i) => {
      const option = document.createElement('li');
      option.id = `installed-font-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.family = family;

      const name = document.createElement('span');
      name.className = 'option-name';
      name.textContent = family;

      const sample = document.createElement('span');
      sample.className = 'option-sample';
      sample.lang = 'ar';
      sample.dir = 'rtl';
      sample.setAttribute('aria-hidden', 'true');
      sample.textContent = t('sampleText');
      sample.style.fontFamily = `"${cleanFontName(family)}", sans-serif`;

      option.append(name, sample);
      return option;
    }),
  );
  installedFonts.hidden = false;
  installedFonts.scrollTop = 0;
  activeOption = -1;
  systemInput.setAttribute('aria-expanded', 'true');
  systemInput.removeAttribute('aria-activedescendant');
}

function moveActiveOption(step: number): void {
  const options = suggestions();
  if (options.length === 0) return;
  options[activeOption]?.setAttribute('aria-selected', 'false');
  activeOption = (activeOption + step + options.length) % options.length;
  const option = options[activeOption]!;
  option.setAttribute('aria-selected', 'true');
  option.scrollIntoView({ block: 'nearest' });
  systemInput.setAttribute('aria-activedescendant', option.id);
}

function chooseSuggestion(option: HTMLElement): void {
  systemInput.value = option.dataset.family ?? '';
  showSystemSample(systemInput.value);
  closeSuggestions();
}

/**
 * Whether an installed font has a bold face. Without one, pages draw bold text in the
 * regular face, emboldened. Undefined when it cannot be told here.
 */
async function hasBoldFace(name: string): Promise<boolean | undefined> {
  if (typeof FontFace !== 'function') return undefined;
  try {
    await new FontFace('Khatt Bold Probe', systemBoldSources(name)).load();
    return true;
  } catch {
    return false;
  }
}

async function listInstalledFonts(): Promise<void> {
  try {
    const fonts = (await window.queryLocalFonts?.()) ?? [];
    families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    if (families.length) {
      systemInput.focus();
      showSuggestions();
    }
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
  if (!(await confirmImport())) return;
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

  systemInput.addEventListener('input', () => {
    showSystemSample(systemInput.value);
    showSuggestions();
  });
  systemInput.addEventListener('click', showSuggestions);
  systemInput.addEventListener('blur', closeSuggestions);
  systemInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (families.length === 0) return;
      event.preventDefault();
      if (installedFonts.hidden) showSuggestions();
      else moveActiveOption(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Escape' && !installedFonts.hidden) {
      event.preventDefault();
      closeSuggestions();
    } else if (event.key === 'Enter' && activeOption >= 0) {
      // Enter on a highlighted suggestion picks it; otherwise it applies the font (the form submits).
      event.preventDefault();
      const option = suggestions()[activeOption];
      if (option) chooseSuggestion(option);
    }
  });
  // mousedown would move focus out of the field and close the list before the click lands.
  installedFonts.addEventListener('mousedown', (event) => event.preventDefault());
  installedFonts.addEventListener('click', (event) => {
    const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (option) chooseSuggestion(option);
  });

  // A form, so pressing Enter in the field applies the font too.
  $('system-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = cleanFontName(systemInput.value);
    if (!name) {
      status(systemStatus, t('systemFontEmpty'), true);
      return;
    }
    // Still applied (the check can be wrong), but an unknown name would silently change nothing.
    if (isFontInstalled(name)) status(systemStatus, '');
    else status(systemStatus, t('systemFontMissing', name), true);
    void commit(async () => {
      await setSystemFont(name, await hasBoldFace(name));
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
      // Sites that chose the system font for themselves go back to the global font.
      for (const { hostname, config } of sites) {
        const keys = (['fontId', 'headingFontId'] as const).filter(
          (key) => config.overrides?.[key] === SYSTEM_FONT_ID,
        );
        if (keys.length) await removeSiteOverrideKeys(hostname, keys);
      }
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
