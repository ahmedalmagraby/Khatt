import { describe, expect, it } from 'vitest';
import { ARABIC_RE, ARABIC_UNICODE_RANGE, arabicShare } from '../../lib/arabic';
import { parseBackup, buildBackup } from '../../lib/backup';
import { effectiveFontId } from '../../lib/fonts';
import {
  isNumericOnly,
  stripTashkeel,
  toArabicIndicDigitsInProse,
  transformText,
} from '../../lib/transforms';

describe('arabic detection boundaries', () => {
  it('does not treat the byte-order mark / zero-width no-break space as Arabic', () => {
    expect(ARABIC_RE.test('﻿')).toBe(false);
    expect(ARABIC_RE.test('Hello﻿ world')).toBe(false);
    expect(ARABIC_UNICODE_RANGE).toContain('U+FE70-FEFC');
    expect(ARABIC_UNICODE_RANGE).not.toContain('FEFF');
  });

  it('still matches the last real presentation form', () => {
    expect(ARABIC_RE.test('ﻼ')).toBe(true);
    expect(ARABIC_RE.test('ﹰ')).toBe(true);
  });

  it('measures how much of a text is Arabic by letters', () => {
    expect(arabicShare('مرحبا بالعالم')).toBe(1);
    expect(arabicShare('Hello world')).toBe(0);
    expect(arabicShare('123 — !!')).toBe(0);
    expect(arabicShare('العربية · English · Français · Deutsch')).toBeLessThan(0.5);
    expect(arabicShare('iPhone هو هاتف ذكي تنتجه شركة معروفة')).toBeGreaterThan(0.5);
    // Digits and vowel marks do not count as letters either way.
    expect(arabicShare('عَرَبِيّ ٢٠٢٤')).toBe(1);
  });
});

describe('tashkeel', () => {
  it('strips extended vowel signs and Quranic annotation marks', () => {
    expect(stripTashkeel('اٖبٗتٟث')).toBe('ابتث');
    expect(stripTashkeel('قۖلۤمۭن')).toBe('قلمن');
    expect(stripTashkeel('ب࣓تࣿ')).toBe('بت');
  });

  it('keeps maddah and hamza marks, which are part of the letter in decomposed text', () => {
    expect(stripTashkeel('آ')).toBe('آ');
    expect(stripTashkeel('أ')).toBe('أ');
    expect(stripTashkeel('إ')).toBe('إ');
    // Tatweel and the end-of-ayah sign are not vowel marks.
    expect(stripTashkeel('ـ۝')).toBe('ـ۝');
  });
});

describe('numerals in prose', () => {
  it('converts plain numbers but leaves tokens containing Latin letters alone', () => {
    expect(toArabicIndicDigitsInProse('عام 2024 شهد 15 حدثا')).toBe('عام ٢٠٢٤ شهد ١٥ حدثا');
    expect(toArabicIndicDigitsInProse('الإصدار v2.4.1 على https://example.com/2026 منذ 2026')).toBe(
      'الإصدار v2.4.1 على https://example.com/2026 منذ ٢٠٢٦',
    );
    expect(toArabicIndicDigitsInProse('الساعة 10:30 بنسبة 15% وسعر $20')).toBe(
      'الساعة ١٠:٣٠ بنسبة ١٥% وسعر $٢٠',
    );
    expect(toArabicIndicDigitsInProse('راسلنا على team2@example.com')).toBe(
      'راسلنا على team2@example.com',
    );
  });

  it('is what the numeral setting uses', () => {
    expect(transformText('الهاتف A52 بسعر 300', { hideTashkeel: false, numerals: 'arabic-indic' })).toBe(
      'الهاتف A52 بسعر ٣٠٠',
    );
  });

  it('recognises a bare number', () => {
    expect(isNumericOnly('2024')).toBe(true);
    expect(isNumericOnly(' 15% ')).toBe(true);
    expect(isNumericOnly('٢٠٢٤')).toBe(true);
    expect(isNumericOnly('v2')).toBe(false);
    expect(isNumericOnly('عام 2024')).toBe(false);
    expect(isNumericOnly('—')).toBe(false);
  });
});

describe('effective font', () => {
  it('uses the system font only where a name is known on the device', () => {
    expect(effectiveFontId('system', 'Tahoma')).toBe('system');
    expect(effectiveFontId('system', '')).toBe('ibm-plex-sans-arabic');
    expect(effectiveFontId('system', '   ')).toBe('ibm-plex-sans-arabic');
  });

  it('falls back to the default for an unknown id', () => {
    expect(effectiveFontId('amiri', '')).toBe('amiri');
    expect(effectiveFontId('gone-font', 'Tahoma')).toBe('ibm-plex-sans-arabic');
  });
});

describe('backup of local-file settings', () => {
  it('keeps the settings stored for local files (empty hostname)', () => {
    const data = { version: 1, 'site:': { enabled: false } };
    expect(parseBackup(JSON.stringify(buildBackup(data)))).toEqual(data);
  });
});

describe('second review', () => {
  it('keeps the digits of a number that follows a Latin name', () => {
    expect(toArabicIndicDigitsInProse('نظام Windows 11 صدر عام 2021')).toBe('نظام Windows 11 صدر عام ٢٠٢١');
    expect(toArabicIndicDigitsInProse('هاتف iPhone 16 بسعر 999 دولار')).toBe('هاتف iPhone 16 بسعر ٩٩٩ دولار');
    // Latin letters outside ASCII mark a technical token too.
    expect(toArabicIndicDigitsInProse('مقهى Café2 في 2024')).toBe('مقهى Café2 في ٢٠٢٤');
  });

  it('brings imported numbers into the range the popup can show and drops unknown choices', () => {
    const data = parseBackup(
      JSON.stringify({
        app: 'khatt',
        data: {
          global: { sizeAdjust: 180, lineHeight: 1.2, wordSpacing: 2, numerals: 'roman', fontId: 'amiri' },
          'site:a.example': { overrides: { lineHeight: -3, sizeAdjust: 10, numerals: 'western' } },
        },
      }),
    );
    expect(data.global).toEqual({ sizeAdjust: 140, lineHeight: 1.4, wordSpacing: 0.3, fontId: 'amiri' });
    expect(data['site:a.example']).toEqual({ overrides: { lineHeight: 0, sizeAdjust: 80, numerals: 'western' } });
  });
});
