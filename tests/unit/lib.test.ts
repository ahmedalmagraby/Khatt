import { describe, expect, it } from 'vitest';
import { ARABIC_RE, startsWithArabic } from '../../lib/arabic';
import { baseCss, fontFaceCss, lineHeightBucket, stackRule, stripOwnFamily } from '../../lib/css';
import { getFont } from '../../lib/fonts';
import {
  DEFAULT_SETTINGS,
  hasOverrides,
  isEmptySite,
  resolveSettings,
  withoutSiteOverrides,
  withSiteEnabled,
  withSiteOverrides,
} from '../../lib/settings';

describe('typography and direction css', () => {
  it('detects right-to-left text by its first letter', () => {
    expect(startsWithArabic('مرحبا world')).toBe(true);
    expect(startsWithArabic('  123 — مرحبا')).toBe(true);
    expect(startsWithArabic('Hello مرحبا')).toBe(false);
    expect(startsWithArabic('123 !!')).toBe(false);
  });

  it('buckets line height in tenths of the font size', () => {
    expect(lineHeightBucket('24px', '16px')).toBe(15);
    expect(lineHeightBucket('normal', '16px')).toBe(12);
    expect(lineHeightBucket('200px', '16px')).toBe(40);
    expect(lineHeightBucket('20px', '0px')).toBe(12);
  });

  it('always removes letter-spacing and only adds what is switched on', () => {
    const off = baseCss({ ...DEFAULT_SETTINGS, lineHeight: 0, wordSpacing: 0, fixDirection: false });
    expect(off).toBe('[data-khatt]:not(#k_):not(#k_){letter-spacing:0 !important}');

    const on = baseCss({ ...DEFAULT_SETTINGS, lineHeight: 1.7, wordSpacing: 0.1, fixDirection: true });
    expect(on).toContain('word-spacing:0.1em !important');
    expect(on).toContain('unicode-bidi:plaintext');
    expect(on).toContain('[data-khatt-dir="rtl"]:not(#k_):not(#k_){direction:rtl');
    // Only elements whose own line height is below 1.7 are raised.
    expect(on).toContain('[data-khatt-prose="16"]');
    expect(on).not.toContain('[data-khatt-prose="17"]');
    expect(on).toContain('{line-height:1.7 !important}');
  });

  it('clamps the new settings', () => {
    expect(resolveSettings({ lineHeight: 9 }).lineHeight).toBe(3);
    expect(resolveSettings({ lineHeight: 0.5 }).lineHeight).toBe(1.2);
    expect(resolveSettings({ lineHeight: 0 }).lineHeight).toBe(0);
    expect(resolveSettings({ wordSpacing: 4 }).wordSpacing).toBe(0.5);
    expect(resolveSettings({ wordSpacing: -1 }).wordSpacing).toBe(0);
    expect(resolveSettings({ fixDirection: false }).fixDirection).toBe(false);
  });
});

describe('site config helpers', () => {
  it('stores the site switch only when off', () => {
    expect(withSiteEnabled({}, false)).toEqual({ enabled: false });
    expect(withSiteEnabled({ enabled: false }, true)).toEqual({});
    expect(withSiteEnabled({ overrides: { fontId: 'x' } }, false)).toEqual({
      enabled: false,
      overrides: { fontId: 'x' },
    });
  });

  it('merges overrides and never overrides the master switch', () => {
    const site = withSiteOverrides({ overrides: { fontId: 'a' } }, { sizeAdjust: 120, enabled: false });
    expect(site).toEqual({ overrides: { fontId: 'a', sizeAdjust: 120 } });
    expect(hasOverrides(site)).toBe(true);
  });

  it('knows when a site config is not worth storing', () => {
    expect(isEmptySite({})).toBe(true);
    expect(isEmptySite(undefined)).toBe(true);
    expect(isEmptySite({ overrides: {} })).toBe(true);
    expect(isEmptySite({ enabled: false })).toBe(false);
    expect(isEmptySite({ overrides: { fontId: 'a' } })).toBe(false);
    expect(isEmptySite(withoutSiteOverrides({ overrides: { fontId: 'a' } }))).toBe(true);
    expect(withoutSiteOverrides({ enabled: false, overrides: { fontId: 'a' } })).toEqual({
      enabled: false,
    });
  });
});

describe('arabic detection', () => {
  it('detects Arabic, Persian and Urdu letters', () => {
    expect(ARABIC_RE.test('مرحبا بالعالم')).toBe(true);
    expect(ARABIC_RE.test('Hello مرحبا')).toBe(true);
    expect(ARABIC_RE.test('گچپژ')).toBe(true);
    expect(ARABIC_RE.test('ٹڈڑ')).toBe(true);
  });

  it('ignores Latin, digits, punctuation and emoji', () => {
    expect(ARABIC_RE.test('Hello, world! 123')).toBe(false);
    expect(ARABIC_RE.test('👨‍👩‍👧 ✓')).toBe(false);
    expect(ARABIC_RE.test('')).toBe(false);
  });

});

describe('css generation', () => {
  it('strips our own family from an inherited computed stack', () => {
    expect(stripOwnFamily('"Khatt Arabic", Georgia, serif')).toBe('Georgia, serif');
    expect(stripOwnFamily('"Khatt Arabic", "Khatt Arabic", Arial')).toBe('Arial');
    expect(stripOwnFamily('Arial, sans-serif')).toBe('Arial, sans-serif');
  });

  it('keeps the original stack as fallback', () => {
    expect(stackRule(3, 'Georgia, serif')).toBe(
      '[data-khatt="3"]:not(#k_):not(#k_){font-family:"Khatt Arabic",Georgia, serif !important}',
    );
  });

  it('emits one Arabic-only @font-face per face, scaled by size', () => {
    const font = getFont('ibm-plex-sans-arabic');
    const css = fontFaceCss(font, 110, (f) => `ext://fonts/${f}`);
    expect(css.match(/@font-face/g)).toHaveLength(font.faces.length);
    expect(css).toContain('unicode-range:U+0600-06FF');
    expect(css).toContain('size-adjust:' + Math.round(font.sizeAdjust * 1.1) + '%');
    expect(css).toContain('url("ext://fonts/ibm-plex-sans-arabic-400.woff2")');
  });

  it('falls back to the first font for an unknown id', () => {
    expect(getFont('nope').id).toBe('ibm-plex-sans-arabic');
  });
});

describe('settings resolution', () => {
  it('returns defaults when nothing is stored', () => {
    expect(resolveSettings()).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings(null, null)).toEqual(DEFAULT_SETTINGS);
  });

  it('layers global then site overrides', () => {
    const s = resolveSettings({ sizeAdjust: 120 }, { overrides: { sizeAdjust: 90 } });
    expect(s.sizeAdjust).toBe(90);
    expect(resolveSettings({ sizeAdjust: 120 }).sizeAdjust).toBe(120);
  });

  it('lets a site turn Khatt off but not override the master switch', () => {
    expect(resolveSettings({}, { enabled: false }).enabled).toBe(false);
    expect(resolveSettings({ enabled: false }, { enabled: true }).enabled).toBe(false);
    expect(resolveSettings({ enabled: true }, { enabled: true }).enabled).toBe(true);
  });

  it('clamps size and ignores undefined values', () => {
    expect(resolveSettings({ sizeAdjust: 999 }).sizeAdjust).toBe(200);
    expect(resolveSettings({ sizeAdjust: 1 }).sizeAdjust).toBe(50);
    expect(resolveSettings({ fontId: undefined }).fontId).toBe(DEFAULT_SETTINGS.fontId);
  });
});
