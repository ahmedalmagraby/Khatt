export type Numerals = 'off' | 'arabic-indic' | 'western';

export const NUMERAL_MODES: readonly Numerals[] = ['off', 'arabic-indic', 'western'];

export interface TransformOptions {
  hideTashkeel: boolean;
  numerals: Numerals;
}

/**
 * Vowel marks and Quranic annotation: fathatan … sukun, the extended vowel signs,
 * superscript alef, and the Quranic marks in Arabic and Arabic Extended-A.
 * Maddah and hamza above/below (U+0653–U+0655) are left alone: in decomposed text
 * they are part of the letter (آ أ إ), not optional vocalisation.
 */
const TASHKEEL_RE =
  /[ً-ْٖ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ࣓-ࣣ࣡-ࣿ]/g;
const WESTERN_DIGIT_RE = /[0-9]/g;
const ARABIC_INDIC_DIGIT_RE = /[٠-٩]/g;
const PERSIAN_DIGIT_RE = /[۰-۹]/g;
const TOKEN_RE = /\S+/g;
const LATIN_LETTER_RE = /\p{Script=Latin}/u;
/** A number on its own, possibly a version ("17.4", "3-1") and wrapped in punctuation ("(3.12)", "11."). */
const BARE_NUMBER_RE = /^[(\[«"'“]*\p{Nd}+(?:[.,:\-/]\p{Nd}+)*[)\]»"'”.,:;!?،؛؟]*$/u;
const ANY_DIGIT_RE = /\p{Nd}/u;
const ANY_LETTER_RE = /\p{L}/u;

export function hasTransforms(options: TransformOptions): boolean {
  return options.hideTashkeel || options.numerals !== 'off';
}

export function stripTashkeel(text: string): string {
  return text.replace(TASHKEEL_RE, '');
}

export function toArabicIndicDigits(text: string): string {
  return text.replace(WESTERN_DIGIT_RE, (d) => String.fromCharCode(0x0660 + Number(d)));
}

/**
 * Like toArabicIndicDigits, but leaves technical tokens alone: any run of
 * non-space characters that contains a Latin letter (version numbers, URLs,
 * product codes, e-mail addresses) keeps its digits. So does a bare number right
 * after such a token, which is nearly always part of a name ("Windows 11", "iPhone 16").
 */
export function toArabicIndicDigitsInProse(text: string): string {
  let afterLatin = false;
  return text.replace(TOKEN_RE, (token) => {
    const latin = LATIN_LETTER_RE.test(token);
    const keep = latin || (afterLatin && BARE_NUMBER_RE.test(token));
    afterLatin = latin;
    return keep ? token : toArabicIndicDigits(token);
  });
}

export function toWesternDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC_DIGIT_RE, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGIT_RE, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** A piece of text that is a number on its own: has a digit and no letters ("2024", "15%", "10:30"). */
export function isNumericOnly(text: string): boolean {
  return ANY_DIGIT_RE.test(text) && !ANY_LETTER_RE.test(text);
}

export function transformText(text: string, options: TransformOptions): string {
  let out = text;
  if (options.hideTashkeel) out = stripTashkeel(out);
  if (options.numerals === 'arabic-indic') out = toArabicIndicDigitsInProse(out);
  else if (options.numerals === 'western') out = toWesternDigits(out);
  return out;
}
