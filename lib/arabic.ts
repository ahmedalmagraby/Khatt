/**
 * Arabic-script detection. Covers Arabic, Arabic Supplement, Arabic Extended-A/B
 * and the presentation forms, so Persian, Urdu, Kurdish etc. match too.
 *
 * Presentation Forms-B stops at U+FEFC on purpose: U+FEFF is the byte-order mark /
 * zero-width no-break space, which editors and templates drop into plain Latin text.
 */
export const ARABIC_RE = /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-ﻼ]/;

const ARABIC_GLOBAL_RE = /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-ﻼ]/g;
const LETTER_GLOBAL_RE = /\p{L}/gu;

/** The same blocks as ARABIC_RE, in CSS `unicode-range` syntax. */
export const ARABIC_UNICODE_RANGE =
  'U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFC';

const FIRST_LETTER_RE = /\p{L}/u;

/** True when the first letter in `text` is Arabic-script, i.e. the text reads right-to-left. */
export function startsWithArabic(text: string): boolean {
  const first = text.match(FIRST_LETTER_RE)?.[0];
  return first !== undefined && ARABIC_RE.test(first);
}

/** Share of the letters in `text` that are Arabic-script, from 0 to 1 (0 when there are no letters). */
export function arabicShare(text: string): number {
  const letters = text.match(LETTER_GLOBAL_RE)?.length ?? 0;
  if (letters === 0) return 0;
  const arabic = text.match(ARABIC_GLOBAL_RE)?.filter((ch) => FIRST_LETTER_RE.test(ch)).length ?? 0;
  return arabic / letters;
}
