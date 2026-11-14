/**
 * Arabic-script detection. Covers Arabic, Arabic Supplement, Arabic Extended-A/B
 * and the presentation forms, so Persian, Urdu, Kurdish etc. match too.
 */
export const ARABIC_RE = /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-﻿]/;

/** The same blocks as ARABIC_RE, in CSS `unicode-range` syntax. */
export const ARABIC_UNICODE_RANGE =
  'U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF';

const FIRST_LETTER_RE = /\p{L}/u;

/** True when the first letter in `text` is Arabic-script, i.e. the text reads right-to-left. */
export function startsWithArabic(text: string): boolean {
  const first = text.match(FIRST_LETTER_RE)?.[0];
  return first !== undefined && ARABIC_RE.test(first);
}
