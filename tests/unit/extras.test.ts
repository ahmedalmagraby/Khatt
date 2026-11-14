import { describe, expect, it } from 'vitest';
import { baseCss } from '../../lib/css';
import { BUNDLED_FONTS } from '../../lib/fonts';
import { matchingPreset, PRESETS } from '../../lib/presets';
import { DEFAULT_SETTINGS, resolveSettings } from '../../lib/settings';
import {
  hasTransforms,
  stripTashkeel,
  toArabicIndicDigits,
  toWesternDigits,
  transformText,
} from '../../lib/transforms';

describe('text transforms', () => {
  it('strips tashkeel but keeps letters, shadda-less text and tatweel', () => {
    expect(stripTashkeel('العَرَبِيَّةُ لُغَةٌ')).toBe('العربية لغة');
    expect(stripTashkeel('رَحْمٰن')).toBe('رحمن');
    expect(stripTashkeel('جمـــيل abc')).toBe('جمـــيل abc');
  });

  it('converts digits both ways, including Persian digits', () => {
    expect(toArabicIndicDigits('عام 2024')).toBe('عام ٢٠٢٤');
    expect(toWesternDigits('٢٠٢٤ و ۱۴۰۳')).toBe('2024 و 1403');
    expect(toWesternDigits(toArabicIndicDigits('0123456789'))).toBe('0123456789');
  });

  it('applies only what is switched on', () => {
    const src = 'سَنَةُ 2024';
    expect(transformText(src, { hideTashkeel: false, numerals: 'off' })).toBe(src);
    expect(transformText(src, { hideTashkeel: true, numerals: 'off' })).toBe('سنة 2024');
    expect(transformText(src, { hideTashkeel: true, numerals: 'arabic-indic' })).toBe('سنة ٢٠٢٤');
    expect(hasTransforms({ hideTashkeel: false, numerals: 'off' })).toBe(false);
    expect(hasTransforms({ hideTashkeel: false, numerals: 'western' })).toBe(true);
  });
});

describe('extras settings', () => {
  it('are off by default and validated', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ hideTashkeel: false, numerals: 'off', justify: false });
    expect(resolveSettings({ numerals: 'bogus' as never }).numerals).toBe('off');
    expect(resolveSettings({ numerals: 'western' }).numerals).toBe('western');
  });

  it('adds the justify rule only when switched on', () => {
    expect(baseCss(DEFAULT_SETTINGS)).not.toContain('justify');
    const css = baseCss({ ...DEFAULT_SETTINGS, justify: true });
    expect(css).toContain('[data-khatt-justify]:not(#k_):not(#k_){text-align:justify !important}');
    // Must come after the direction rules to win over their text-align.
    expect(css.indexOf('text-align:justify')).toBeGreaterThan(css.indexOf('text-align:start'));
  });
});

describe('presets', () => {
  it('reference bundled fonts and survive settings validation unchanged', () => {
    for (const preset of PRESETS) {
      expect(BUNDLED_FONTS.some((f) => f.id === preset.patch.fontId)).toBe(true);
      expect(resolveSettings(preset.patch)).toMatchObject(preset.patch);
    }
  });

  it('are distinct, and one is recognised from resolved settings', () => {
    for (const preset of PRESETS) {
      expect(matchingPreset(resolveSettings(preset.patch))?.id).toBe(preset.id);
    }
    expect(matchingPreset({ ...DEFAULT_SETTINGS, sizeAdjust: 123 })).toBeUndefined();
  });
});
