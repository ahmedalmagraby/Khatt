export type Numerals = 'off' | 'arabic-indic' | 'western';

export const NUMERAL_MODES: readonly Numerals[] = ['off', 'arabic-indic', 'western'];

export interface TransformOptions {
  hideTashkeel: boolean;
  numerals: Numerals;
}

/** Fathatan … sukun, plus the superscript alef. */
const TASHKEEL_RE = /[ً-ْٰ]/g;
const WESTERN_DIGIT_RE = /[0-9]/g;
const ARABIC_INDIC_DIGIT_RE = /[٠-٩]/g;
const PERSIAN_DIGIT_RE = /[۰-۹]/g;

export function hasTransforms(options: TransformOptions): boolean {
  return options.hideTashkeel || options.numerals !== 'off';
}

export function stripTashkeel(text: string): string {
  return text.replace(TASHKEEL_RE, '');
}

export function toArabicIndicDigits(text: string): string {
  return text.replace(WESTERN_DIGIT_RE, (d) => String.fromCharCode(0x0660 + Number(d)));
}

export function toWesternDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC_DIGIT_RE, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGIT_RE, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function transformText(text: string, options: TransformOptions): string {
  let out = text;
  if (options.hideTashkeel) out = stripTashkeel(out);
  if (options.numerals === 'arabic-indic') out = toArabicIndicDigits(out);
  else if (options.numerals === 'western') out = toWesternDigits(out);
  return out;
}
