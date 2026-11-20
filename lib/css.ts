import { ARABIC_UNICODE_RANGE } from './arabic';
import { getFont, SYSTEM_FONT_ID, type BundledFont } from './fonts';
import type { Settings } from './settings';

/** Private family name; its unicode-range limits it to Arabic-script characters. */
export const FAMILY = 'Khatt Arabic';
/** Second private family, used inside headings when a separate heading font is chosen. */
export const HEADING_FAMILY = 'Khatt Arabic Heading';
/** Attribute placed on elements that directly contain Arabic text. Value = font-stack id. */
export const ATTR = 'data-khatt';
/** On Arabic prose elements. Value = the element's original line height in tenths of its font size. */
export const PROSE_ATTR = 'data-khatt-prose';
/** On blocks whose direction Khatt fixes: "rtl", "rtl-bidi", "auto" or "bidi" — see DirectionValue. */
export const DIR_ATTR = 'data-khatt-dir';
/** On text fields where Khatt added dir="auto", so it can be taken back. */
export const AUTO_DIR_ATTR = 'data-khatt-auto-dir';
/** On prose blocks whose own alignment is plain enough to be justified. */
export const JUSTIFY_ATTR = 'data-khatt-justify';
/**
 * On tagged form controls and editors that hold no Arabic right now. They get the
 * font (Arabic may be typed later) but keep the site's letter and word spacing.
 */
export const PLAIN_ATTR = 'data-khatt-plain';
export const STYLE_ID = 'khatt-style';
/** Announces a shadow root attached to an element already on the page (see shadow-hook). */
export const SHADOW_EVENT = 'khatt:shadow';

/**
 * Appended to every selector. The two :not(#id) parts add id-level specificity, so
 * Khatt's rules also win over a site's own `!important` font and spacing rules.
 */
export const BOOST = ':not(#k_):not(#k_)';

const BUCKET_MIN = 8;
const BUCKET_MAX = 40;

/** Line height as tenths of the font size, from computed px values ("normal" counts as 1.2). */
export function lineHeightBucket(lineHeight: string, fontSize: string): number {
  const size = parseFloat(fontSize);
  const height = parseFloat(lineHeight);
  if (!(size > 0) || Number.isNaN(height)) return 12;
  return Math.min(BUCKET_MAX, Math.max(BUCKET_MIN, Math.round((height / size) * 10)));
}

/** Typography and direction rules for tagged elements; used in the document and in shadow roots. */
export function baseCss(settings: Settings): string {
  const rules: string[] = [];
  // Letter-spacing breaks the joining of Arabic letters. Controls without Arabic in
  // them (an English "SIGN IN" button) keep the tracking their site gave them.
  const spacing =
    settings.wordSpacing > 0 ? `;word-spacing:${settings.wordSpacing}em !important` : '';
  rules.push(`[${ATTR}]:not([${PLAIN_ATTR}])${BOOST}{letter-spacing:0 !important${spacing}}`);

  // Raise the line height of prose only where the site's own is below the minimum.
  if (settings.lineHeight > 0) {
    const limit = Math.min(Math.round(settings.lineHeight * 10), BUCKET_MAX + 1);
    const selectors: string[] = [];
    for (let b = BUCKET_MIN; b < limit; b++) selectors.push(`[${PROSE_ATTR}="${b}"]${BOOST}`);
    if (selectors.length) {
      rules.push(`${selectors.join(',')}{line-height:${settings.lineHeight} !important}`);
    }
  }

  if (settings.fixDirection) {
    // plaintext: every paragraph takes its direction from its own first strong character.
    // "bidi" blocks have a deliberate alignment (e.g. centered): fix punctuation order only.
    rules.push(
      `[${DIR_ATTR}="auto"]${BOOST},[${DIR_ATTR}="bidi"]${BOOST}{unicode-bidi:plaintext !important}`,
    );
    // "rtl" blocks are mainly Arabic and right-to-left as a whole; the "-bidi" forms
    // leave the site's alignment alone.
    rules.push(
      `[${DIR_ATTR}="rtl"]${BOOST},[${DIR_ATTR}="rtl-bidi"]${BOOST}{direction:rtl !important}`,
    );
    rules.push(
      `[${DIR_ATTR}="auto"]${BOOST},[${DIR_ATTR}="rtl"]${BOOST}{text-align:start !important}`,
    );
  }
  // After the direction rules, so it wins over their text-align.
  if (settings.justify) {
    rules.push(`[${JUSTIFY_ATTR}]${BOOST}{text-align:justify !important}`);
  }
  return rules.join('\n');
}

const OWN_FAMILY_PREFIX = /^\s*(["']?)Khatt Arabic(?: Heading)?\1\s*,\s*/;

/** Removes our own family from a computed font-family (present when inherited from a tagged ancestor). */
export function stripOwnFamily(computed: string): string {
  let out = computed;
  while (OWN_FAMILY_PREFIX.test(out)) out = out.replace(OWN_FAMILY_PREFIX, '');
  return out.trim();
}

export function fontFaceCss(
  font: BundledFont,
  sizePercent: number,
  urlFor: (file: string) => string,
  family: string = FAMILY,
): string {
  const size = Math.round((font.sizeAdjust * sizePercent) / 100);
  return font.faces
    .map(
      (face) =>
        `@font-face{font-family:"${family}";src:url("${urlFor(face.file)}") format("woff2");` +
        `font-weight:${face.weight};font-style:normal;font-display:swap;` +
        `size-adjust:${size}%;unicode-range:${ARABIC_UNICODE_RANGE}}`,
    )
    .join('\n');
}

/** A font-family name made safe to place inside a quoted CSS string. */
export function cleanFontName(name: string): string {
  // \f is a CSS newline too: it would end the quoted string.
  return name.replace(/["\\\n\r\f]/g, '').trim().slice(0, 100);
}

/**
 * The local() sources of an installed font's bold face. local() matches a face's full
 * name ("Family Bold") or its PostScript name ("Family-Bold", no spaces).
 */
export function systemBoldSources(name: string): string {
  const clean = cleanFontName(name);
  return `local("${clean} Bold"),local("${clean.replace(/\s+/g, '')}-Bold")`;
}

/**
 * @font-face for a font installed on the user's computer, limited to Arabic like the
 * bundled ones. `bold` says whether the font has a bold face (checked when it was
 * chosen); undefined when that is not known.
 */
export function systemFontFaceCss(
  name: string,
  sizePercent: number,
  family: string = FAMILY,
  bold?: boolean,
): string {
  const clean = cleanFontName(name);
  const tail = `font-style:normal;size-adjust:${Math.round(sizePercent)}%;unicode-range:${ARABIC_UNICODE_RANGE}}`;
  // Some fonts spell out "Regular" in the full name of their regular face.
  const regular =
    `@font-face{font-family:"${family}";src:local("${clean}"),local("${clean} Regular"),` +
    `local("${clean.replace(/\s+/g, '')}-Regular");font-weight:400;${tail}`;
  // No bold face: no 700 rule, so bold text uses the regular face, emboldened by the
  // browser. (A 700 rule whose sources are all missing would hand bold Arabic to the
  // next font in the site's stack instead.)
  if (bold === false) return regular;
  // Known to have one: bold names only, so it is never the regular face drawn at 700.
  // Not known: the regular face as a last resort, so bold text keeps the chosen font.
  const fallback = bold ? '' : `,local("${clean}")`;
  return `${regular}\n@font-face{font-family:"${family}";src:${systemBoldSources(clean)}${fallback};font-weight:700;${tail}`;
}

/** @font-face block for a font choice: a bundled font id, or the system font when its name is known. */
export function fontCssFor(
  fontId: string,
  systemFont: string,
  sizePercent: number,
  urlFor: (file: string) => string,
  family: string = FAMILY,
  systemBold?: boolean,
): string {
  if (fontId === SYSTEM_FONT_ID && cleanFontName(systemFont)) {
    return systemFontFaceCss(systemFont, sizePercent, family, systemBold);
  }
  return fontFaceCss(getFont(fontId), sizePercent, urlFor, family);
}

/** One bundled font file to register under a family, for loading from bytes instead of a URL. */
export interface FaceSpec {
  family: string;
  file: string;
  weight: string;
  /** Percent, already combined with the font's own optical correction. */
  sizeAdjust: number;
}

/** The faces of a bundled font choice, or null when the choice is the installed system font. */
export function fontSpecsFor(
  fontId: string,
  systemFont: string,
  sizePercent: number,
  family: string = FAMILY,
): FaceSpec[] | null {
  if (fontId === SYSTEM_FONT_ID && cleanFontName(systemFont)) return null;
  const font = getFont(fontId);
  const sizeAdjust = Math.round((font.sizeAdjust * sizePercent) / 100);
  return font.faces.map((face) => ({ family, file: face.file, weight: face.weight, sizeAdjust }));
}

/** One rule per distinct original font stack; the site's own fonts stay as fallback. */
export function stackRule(token: string | number, stack: string, family: string = FAMILY): string {
  return `[${ATTR}="${token}"]${BOOST}{font-family:"${family}",${stack} !important}`;
}
