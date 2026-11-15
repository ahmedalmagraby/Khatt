import { DEFAULT_FONT_ID } from './fonts';
import { NUMERAL_MODES, type Numerals } from './transforms';

export const SETTINGS_VERSION = 1;

export interface Settings {
  /** Master switch (global) — a site can only turn Khatt off, not force it on. */
  enabled: boolean;
  fontId: string;
  /** Separate font for Arabic text inside headings. Empty = same as the body font. */
  headingFontId: string;
  /** Arabic glyph size in percent of the font's own optical default. */
  sizeAdjust: number;
  /** Minimum line height for Arabic prose, as a multiple of the font size. 0 = leave the site's. */
  lineHeight: number;
  /** Extra space between words in em. 0 = leave the site's. */
  wordSpacing: number;
  /** Fix direction and alignment of Arabic paragraphs, lists and text fields on LTR pages. */
  fixDirection: boolean;
  /** Hide diacritics (tashkeel) in Arabic text. */
  hideTashkeel: boolean;
  /** Convert digits inside Arabic text. */
  numerals: Numerals;
  /** Justify Arabic prose paragraphs. */
  justify: boolean;
}

export interface SiteConfig {
  enabled?: boolean;
  overrides?: Partial<Settings>;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  fontId: DEFAULT_FONT_ID,
  headingFontId: '',
  sizeAdjust: 100,
  lineHeight: 1.7,
  wordSpacing: 0,
  fixDirection: true,
  hideTashkeel: false,
  numerals: 'off',
  justify: false,
};

// The ranges the popup's sliders offer (it reads them from here), so a stored value
// can always be shown as it is applied.
export const SIZE_MIN = 80;
export const SIZE_MAX = 140;
export const LINE_HEIGHT_MIN = 1.4;
export const LINE_HEIGHT_MAX = 2.4;
export const WORD_SPACING_MAX = 0.3;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const GLOBAL_KEY = 'global';
export const VERSION_KEY = 'version';

export function siteKey(hostname: string): string {
  return `site:${hostname}`;
}

function defined<T extends object>(obj: T | undefined | null): Partial<T> {
  const out: Partial<T> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

const NUMBER_RANGES = {
  sizeAdjust: [SIZE_MIN, SIZE_MAX],
  lineHeight: [LINE_HEIGHT_MIN, LINE_HEIGHT_MAX],
  wordSpacing: [0, WORD_SPACING_MAX],
} as const;

/**
 * One setting as it may be stored: numbers brought into range, choices checked.
 * Returns undefined for a value that cannot be used at all.
 */
export function normalizeSetting(key: keyof Settings, value: unknown): unknown {
  switch (key) {
    case 'sizeAdjust':
    case 'lineHeight':
    case 'wordSpacing': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      // 0 (or less) switches the line-height minimum off.
      if (key === 'lineHeight' && value <= 0) return 0;
      const [min, max] = NUMBER_RANGES[key];
      return clamp(value, min, max);
    }
    case 'numerals':
      return NUMERAL_MODES.includes(value as Numerals) ? value : undefined;
    case 'fontId':
    case 'headingFontId':
      return typeof value === 'string' && value.length <= 100 ? value : undefined;
    default:
      return typeof value === 'boolean' ? value : undefined;
  }
}

/** Effective settings = defaults ← global ← site overrides. */
export function resolveSettings(
  global?: Partial<Settings> | null,
  site?: SiteConfig | null,
): Settings {
  const g = defined(global);
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...g,
    ...defined(site?.overrides),
  };
  const globalEnabled = g.enabled ?? DEFAULT_SETTINGS.enabled;
  merged.enabled = globalEnabled && site?.enabled !== false;
  merged.sizeAdjust = clamp(Number(merged.sizeAdjust) || 100, SIZE_MIN, SIZE_MAX);
  const lh = Number(merged.lineHeight) || 0;
  merged.lineHeight = lh <= 0 ? 0 : clamp(lh, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX);
  merged.wordSpacing = clamp(Number(merged.wordSpacing) || 0, 0, WORD_SPACING_MAX);
  merged.fontId = typeof merged.fontId === 'string' ? merged.fontId : DEFAULT_FONT_ID;
  merged.headingFontId = typeof merged.headingFontId === 'string' ? merged.headingFontId : '';
  merged.fixDirection = Boolean(merged.fixDirection);
  merged.hideTashkeel = Boolean(merged.hideTashkeel);
  merged.justify = Boolean(merged.justify);
  if (!NUMERAL_MODES.includes(merged.numerals)) merged.numerals = 'off';
  return merged;
}

export function hasOverrides(site?: SiteConfig | null): boolean {
  return Object.keys(defined(site?.overrides)).length > 0;
}

/** Site config with the on/off switch changed. Enabled is the default, so it is stored only when off. */
export function withSiteEnabled(site: SiteConfig | null | undefined, enabled: boolean): SiteConfig {
  const next: SiteConfig = { ...site };
  if (enabled) delete next.enabled;
  else next.enabled = false;
  return next;
}

/** Site config with `patch` merged into its overrides. The master switch is never a site override. */
export function withSiteOverrides(
  site: SiteConfig | null | undefined,
  patch: Partial<Settings>,
): SiteConfig {
  const overrides = { ...defined(site?.overrides), ...defined(patch) };
  delete overrides.enabled;
  return { ...site, overrides };
}

export function withoutSiteOverrides(site: SiteConfig | null | undefined): SiteConfig {
  const next: SiteConfig = { ...site };
  delete next.overrides;
  return next;
}

/** True when a site config says nothing beyond the defaults and need not be stored. */
export function isEmptySite(site: SiteConfig | null | undefined): boolean {
  return site?.enabled !== false && !hasOverrides(site);
}
