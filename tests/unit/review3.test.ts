import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for chrome.storage.sync whose `set` can be made to fail. */
const store: Record<string, unknown> = {};
let failSet: (data: Record<string, unknown>) => boolean = () => false;

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      sync: {
        get: async (keys: null | string[]) =>
          keys === null
            ? structuredClone(store)
            : Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (data: Record<string, unknown>) => {
          if (failSet(data)) throw new Error('QUOTA_BYTES quota exceeded');
          Object.assign(store, structuredClone(data));
        },
        remove: async (keys: string | string[]) => {
          for (const k of [keys].flat()) delete store[k];
        },
        clear: async () => {
          for (const k of Object.keys(store)) delete store[k];
        },
      },
    },
  },
}));

const { replaceEverything } = await import('../../lib/storage');
const { systemFontFaceCss, cleanFontName } = await import('../../lib/css');
const { toArabicIndicDigitsInProse } = await import('../../lib/transforms');

describe('importing settings', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    Object.assign(store, { global: { fontId: 'amiri' }, 'site:a.com': { enabled: false } });
    failSet = () => false;
  });

  it('replaces everything, dropping keys the backup does not have', async () => {
    await replaceEverything({ global: { fontId: 'tajawal' }, 'site:b.com': { enabled: false } });
    expect(store).toEqual({ global: { fontId: 'tajawal' }, 'site:b.com': { enabled: false } });
  });

  it('leaves the stored settings as they were when the write is refused', async () => {
    const before = structuredClone(store);
    failSet = (data) => 'site:big.com' in data;
    await expect(
      replaceEverything({ global: { fontId: 'tajawal' }, 'site:big.com': { enabled: false } }),
    ).rejects.toThrow();
    expect(store).toEqual(before);
  });

  it('still imports when only old and new together are too much', async () => {
    let calls = 0;
    failSet = () => ++calls === 1;
    await replaceEverything({ global: { fontId: 'tajawal' } });
    expect(store).toEqual({ global: { fontId: 'tajawal' } });
  });
});

describe('installed fonts', () => {
  const boldRule = (css: string) => css.split('\n').find((rule) => rule.includes('font-weight:700'));

  it('has no 700 rule for a font without a bold face, so bold text is emboldened', () => {
    const css = systemFontFaceCss('Aref Ruqaa', 100, undefined, false);
    expect(boldRule(css)).toBeUndefined();
    expect(css).toContain('local("ArefRuqaa-Regular")');
  });

  it('names only bold faces for a font known to have one', () => {
    const bold = boldRule(systemFontFaceCss('Aref Ruqaa', 100, undefined, true))!;
    expect(bold).toContain('local("Aref Ruqaa Bold")');
    expect(bold).toContain('local("ArefRuqaa-Bold")');
    expect(bold).not.toContain('local("Aref Ruqaa")');
  });

  it('keeps the regular face as a last resort when that is not known', () => {
    expect(boldRule(systemFontFaceCss('Aref Ruqaa', 100))).toContain('local("Aref Ruqaa")');
  });

  it('drops form feeds, which would end the quoted name', () => {
    expect(cleanFontName('Ta\fhoma')).toBe('Tahoma');
  });
});

describe('numerals after Latin names', () => {
  it('keeps version numbers and punctuated numbers that belong to a name', () => {
    expect(toArabicIndicDigitsInProse('تحديث iOS 17.4')).toBe('تحديث iOS 17.4');
    expect(toArabicIndicDigitsInProse('نظام Windows 11.')).toBe('نظام Windows 11.');
    expect(toArabicIndicDigitsInProse('(Python 3.12)')).toBe('(Python 3.12)');
    expect(toArabicIndicDigitsInProse('منفذ USB 3.0، وغيره')).toBe('منفذ USB 3.0، وغيره');
  });

  it('still converts numbers in Arabic prose', () => {
    expect(toArabicIndicDigitsInProse('عام 2024. وفي 3.5 ساعة')).toBe('عام ٢٠٢٤. وفي ٣.٥ ساعة');
  });
});
