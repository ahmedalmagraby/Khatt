import { browser } from 'wxt/browser';
import { effectiveFontId } from '@/lib/fonts';
import { ENSURE_MESSAGE, type EnsureStatus } from '@/lib/messages';
import { matchingPreset, PRESETS } from '@/lib/presets';
import { hasOverrides, resolveSettings, type Settings } from '@/lib/settings';
import {
  clearSiteOverrides,
  loadRaw,
  loadSystemFont,
  setSiteEnabled,
  updateGlobal,
  updateSiteOverrides,
  watchStorage,
  type RawSettings,
} from '@/lib/storage';
import type { Numerals } from '@/lib/transforms';
import {
  $,
  checkFontCard,
  fontChoices,
  injectPreviewFaces,
  localize,
  renderFontCards,
  t,
} from '@/lib/ui';

type Scope = 'all' | 'site';

const master = $<HTMLInputElement>('master');
const controls = $('controls');
const siteSection = $('site-section');
const siteEnabled = $<HTMLInputElement>('site-enabled');
const hostLabel = $('host');
const unavailable = $('unavailable');
const overrideNote = $('override-note');
const resetSite = $<HTMLButtonElement>('reset-site');
const fontList = $('font-list');
const presetList = $('preset-list');
const fixDirection = $<HTMLInputElement>('fix-direction');
const hideTashkeel = $<HTMLInputElement>('hide-tashkeel');
const numerals = $<HTMLSelectElement>('numerals');
const justify = $<HTMLInputElement>('justify');
const scopeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="scope"]')];

type NumericKey = 'sizeAdjust' | 'lineHeight' | 'wordSpacing';

interface Slider {
  input: HTMLInputElement;
  output: HTMLElement;
  key: NumericKey;
  /** Slider position → stored value, and back. */
  toSetting(position: number): number;
  fromSetting(value: number): number;
  format(position: number): string;
  timer?: ReturnType<typeof setTimeout>;
}

const LINE_HEIGHT_OFF = 1.3;

const sliders: Slider[] = [
  {
    input: $<HTMLInputElement>('size'),
    output: $('size-value'),
    key: 'sizeAdjust',
    toSetting: (p) => p,
    fromSetting: (v) => v,
    format: (p) => `${p}%`,
  },
  {
    // The lowest position means "leave the site's line height alone" (stored as 0).
    input: $<HTMLInputElement>('line-height'),
    output: $('line-height-value'),
    key: 'lineHeight',
    toSetting: (p) => (p <= LINE_HEIGHT_OFF ? 0 : p),
    fromSetting: (v) => (v <= 0 ? LINE_HEIGHT_OFF : v),
    format: (p) => (p <= LINE_HEIGHT_OFF ? t('off') : p.toFixed(1)),
  },
  {
    input: $<HTMLInputElement>('word-spacing'),
    output: $('word-spacing-value'),
    key: 'wordSpacing',
    toSetting: (p) => p,
    fromSetting: (v) => v,
    format: (p) => (p <= 0 ? t('off') : `+${p.toFixed(2)}em`),
  },
];

let host: string | null = null;
let raw: RawSettings = { global: {}, site: {} };
let scope: Scope = 'all';
let systemFont = '';
/** The system font the font list was last built with; null = not built yet. */
let listedSystemFont: string | null = null;
/** The font card last scrolled into view, so the list only moves when the choice does. */
let shownFontId: string | null = null;

/**
 * The site of the tab the popup was opened on; null where Khatt cannot run.
 * Local files have no hostname and share the empty one.
 */
async function currentHost(): Promise<string | null> {
  // `?host=` lets the popup be opened as a normal page (tests, debugging).
  const override = new URLSearchParams(location.search).get('host');
  if (override) return override;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? '');
    if (url.protocol === 'file:') return '';
    return /^https?:$/.test(url.protocol) && url.hostname ? url.hostname : null;
  } catch {
    return null;
  }
}

/**
 * Makes sure the tab the popup was opened on is running Khatt. A tab that was already
 * open when the extension was installed or updated has no live script until then.
 */
async function ensureActiveTab(): Promise<void> {
  if (host === null || new URLSearchParams(location.search).has('host')) return;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    const reply = (await browser.runtime.sendMessage({ type: ENSURE_MESSAGE, tabId: tab.id })) as
      | { status?: EnsureStatus }
      | undefined;
    // Some pages look like ordinary sites but are closed to extensions (the Web Store,
    // the PDF viewer, error pages). Refreshing would not help, so say Khatt can't run.
    if (reply?.status === 'failed') {
      host = null;
      scope = 'all';
      render();
    }
  } catch {
    // Background unavailable — settings still save and apply on the next page load.
  }
}

/** (Re)builds the font cards when the set of fonts changes — the system font came or went. */
function buildFontList(): void {
  if (listedSystemFont === systemFont) return;
  listedSystemFont = systemFont;
  renderFontCards(fontList, fontChoices(systemFont), t('sampleText'), (id) => void save({ fontId: id }));
}

function buildPresetList(): void {
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.preset = preset.id;
    button.textContent = t(preset.nameKey);
    button.addEventListener('click', () => void save(preset.patch));
    presetList.append(button);
  }
}

/** Values shown in the controls: this site's effective settings, or the global ones. */
function shown(): Settings {
  return scope === 'site' ? resolveSettings(raw.global, raw.site) : resolveSettings(raw.global);
}

function render(): void {
  const globalOn = resolveSettings(raw.global).enabled;
  master.checked = globalOn;
  controls.classList.toggle('off', !globalOn);
  // Not just dimmed: out of the tab order and hidden from assistive technology too.
  controls.inert = !globalOn;

  siteSection.hidden = host === null;
  unavailable.hidden = host !== null;
  hostLabel.textContent = host === '' ? t('localFiles') : (host ?? '');
  siteEnabled.checked = raw.site.enabled !== false;

  for (const input of scopeInputs) {
    input.checked = input.value === scope;
    if (input.value === 'site') input.disabled = host === null;
  }
  overrideNote.hidden = host === null || !hasOverrides(raw.site);

  const s = shown();
  buildFontList();
  const fontId = effectiveFontId(s.fontId, systemFont);
  checkFontCard(fontList, fontId);
  // The list scrolls: bring the chosen font into view, but only when the choice changes,
  // so toggling another control does not yank the list back.
  if (fontId !== shownFontId) {
    shownFontId = fontId;
    fontList.querySelector('input:checked')?.closest('label')?.scrollIntoView({ block: 'nearest' });
  }
  const active = matchingPreset(s)?.id;
  for (const button of presetList.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === active));
  }
  fixDirection.checked = s.fixDirection;
  hideTashkeel.checked = s.hideTashkeel;
  numerals.value = s.numerals;
  justify.checked = s.justify;
  for (const slider of sliders) {
    // Don't fight the user's hand while a drag is still being saved.
    if (!slider.timer) slider.input.value = String(slider.fromSetting(s[slider.key]));
    slider.output.textContent = slider.format(Number(slider.input.value));
  }
}

async function reload(): Promise<void> {
  try {
    [raw, systemFont] = await Promise.all([loadRaw(host), loadSystemFont()]);
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

function save(patch: Partial<Settings>): Promise<void> {
  const target = host;
  return commit(() =>
    scope === 'site' && target !== null ? updateSiteOverrides(target, patch) : updateGlobal(patch),
  );
}

function bind(): void {
  master.addEventListener('change', () => void commit(() => updateGlobal({ enabled: master.checked })));

  siteEnabled.addEventListener('change', () => {
    const target = host;
    if (target !== null) void commit(() => setSiteEnabled(target, siteEnabled.checked));
  });

  for (const input of scopeInputs) {
    input.addEventListener('change', () => {
      scope = input.value as Scope;
      render();
    });
  }

  resetSite.addEventListener('click', () => {
    const target = host;
    if (target === null) return;
    scope = 'all';
    render();
    void commit(() => clearSiteOverrides(target));
  });

  $('open-options').addEventListener('click', () => void browser.runtime.openOptionsPage());

  fixDirection.addEventListener('change', () => void save({ fixDirection: fixDirection.checked }));
  hideTashkeel.addEventListener('change', () => void save({ hideTashkeel: hideTashkeel.checked }));
  numerals.addEventListener('change', () => void save({ numerals: numerals.value as Numerals }));
  justify.addEventListener('change', () => void save({ justify: justify.checked }));

  // Synced storage limits write frequency, so slider drags are debounced — but the
  // value is written at once when the drag ends or the popup closes, so it is never lost.
  const flush = (slider: Slider) => {
    if (!slider.timer) return;
    clearTimeout(slider.timer);
    slider.timer = undefined;
    void save({ [slider.key]: slider.toSetting(Number(slider.input.value)) });
  };
  for (const slider of sliders) {
    slider.input.addEventListener('input', () => {
      slider.output.textContent = slider.format(Number(slider.input.value));
      clearTimeout(slider.timer);
      slider.timer = setTimeout(() => flush(slider), 150);
    });
    slider.input.addEventListener('change', () => flush(slider));
  }
  window.addEventListener('pagehide', () => sliders.forEach(flush));
}

async function init(): Promise<void> {
  localize();
  buildPresetList();
  injectPreviewFaces();
  bind();
  host = await currentHost();
  raw = await loadRaw(host).catch(() => raw);
  systemFont = await loadSystemFont().catch(() => '');
  scope = host !== null && hasOverrides(raw.site) ? 'site' : 'all';
  render();
  watchStorage(host, () => void reload());
  void ensureActiveTab();
}

void init();
