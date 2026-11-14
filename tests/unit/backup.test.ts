import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, sanitizeData } from '../../lib/backup';
import {
  cleanFontName,
  fontCssFor,
  stackRule,
  stripOwnFamily,
  systemFontFaceCss,
} from '../../lib/css';
import { BUNDLED_FONTS } from '../../lib/fonts';
import { resolveSettings } from '../../lib/settings';

const url = (f: string) => `ext://fonts/${f}`;

describe('backup', () => {
  const data = {
    version: 1,
    global: { fontId: 'vazirmatn', sizeAdjust: 110, hideTashkeel: true },
    'site:example.com': { enabled: false },
    'site:ar.wikipedia.org': { overrides: { fontId: 'amiri', lineHeight: 2 } },
  };

  it('round-trips settings through export and import', () => {
    const backup = buildBackup(data, new Date('2026-01-02T03:04:05Z'));
    expect(backup).toMatchObject({ app: 'khatt', exportedAt: '2026-01-02T03:04:05.000Z' });
    expect(parseBackup(JSON.stringify(backup))).toEqual(data);
  });

  it('rejects files that are not Khatt backups', () => {
    expect(() => parseBackup('not json')).toThrow('not-json');
    expect(() => parseBackup('{"data":{}}')).toThrow('not-backup');
    expect(() => parseBackup('{"app":"other","data":{}}')).toThrow('not-backup');
    expect(() => parseBackup('{"app":"khatt","data":[]}')).toThrow('not-backup');
  });

  it('drops unknown keys, wrong types and empty sites', () => {
    const clean = sanitizeData({
      global: { fontId: 42, sizeAdjust: 120, bogus: true, lineHeight: Infinity, justify: 'yes' },
      'site:ok.example': { enabled: false, overrides: { enabled: false, wordSpacing: 0.1 }, x: 1 },
      'site:empty.example': { enabled: true, overrides: {} },
      'site:bad key!': { enabled: false },
      'site:array.example': [],
      other: { anything: 1 },
    });
    expect(clean).toEqual({
      version: 1,
      global: { sizeAdjust: 120 },
      'site:ok.example': { enabled: false, overrides: { wordSpacing: 0.1 } },
    });
  });
});

describe('system and heading fonts', () => {
  it('builds Arabic-only local() faces for an installed font', () => {
    const css = systemFontFaceCss('Sakkal Majalla', 110);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('src:local("Sakkal Majalla")');
    expect(css).toContain('local("Sakkal Majalla Bold")');
    expect(css).toContain('size-adjust:110%');
    expect(css).toContain('unicode-range:U+0600-06FF');
  });

  it('cannot be broken out of by a hostile font name', () => {
    expect(cleanFontName('  Ev"il\\ }\n*{x:y} ')).toBe('Evil }*{x:y}');
    // The quote is removed, so the rest stays inside the string.
    expect(systemFontFaceCss('a");}body{display:none}', 100)).toContain(
      'src:local("a);}body{display:none}")',
    );
  });

  it('uses the system font only when its name is known on this device', () => {
    expect(fontCssFor('system', 'Tahoma', 100, url)).toContain('local("Tahoma")');
    expect(fontCssFor('system', '', 100, url)).toContain(BUNDLED_FONTS[0]!.faces[0]!.file);
    expect(fontCssFor('amiri', 'Tahoma', 100, url)).toContain('amiri-400.woff2');
    expect(fontCssFor('amiri', '', 100, url, 'Khatt Arabic Heading')).toContain(
      'font-family:"Khatt Arabic Heading"',
    );
  });

  it('handles the heading family in rules and inherited stacks', () => {
    expect(stackRule('h2', 'Georgia', 'Khatt Arabic Heading')).toBe(
      '[data-khatt="h2"]:not(#k_):not(#k_){font-family:"Khatt Arabic Heading",Georgia !important}',
    );
    expect(stripOwnFamily('"Khatt Arabic Heading", "Khatt Arabic", Georgia')).toBe('Georgia');
  });

  it('defaults to no separate heading font', () => {
    expect(resolveSettings().headingFontId).toBe('');
    expect(resolveSettings({ headingFontId: 'amiri' }).headingFontId).toBe('amiri');
    expect(resolveSettings({ headingFontId: 5 as never }).headingFontId).toBe('');
  });
});

describe('bundled fonts', () => {
  it('have unique ids and files', () => {
    const ids = BUNDLED_FONTS.map((f) => f.id);
    const files = BUNDLED_FONTS.flatMap((f) => f.faces.map((face) => face.file));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(files).size).toBe(files.length);
    expect(ids).not.toContain('system');
  });
});
