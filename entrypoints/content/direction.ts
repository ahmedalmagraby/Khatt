import { arabicShare, startsWithArabic } from '@/lib/arabic';
import { DIR_ATTR } from '@/lib/css';

/**
 * - `rtl`      the block is right-to-left as a whole, and aligned to the right
 * - `rtl-bidi` right-to-left as a whole, alignment left as the site set it
 * - `auto`     each paragraph in the block takes its direction from its own first letter
 * - `bidi`     as `auto`, alignment left as the site set it
 */
export type DirectionValue = 'rtl' | 'rtl-bidi' | 'auto' | 'bidi';

export interface DirectionFix {
  target: Element;
  value: DirectionValue;
  /** An inline `dir="auto"` wrapper between the text and `target` that needs the same direction. */
  also?: Element;
}

// localName, not tagName: tagName is only upper-cased for HTML elements in HTML documents.
const LIST_NAMES = new Set(['ul', 'ol', 'menu']);
/** Input types whose direction should follow what is typed. */
const DIR_FIELD_TYPES = new Set(['text', 'search']);
/** Input types that draw text (a value, a label or a placeholder) and so need the font. */
const FONT_FIELD_TYPES = new Set([
  'text',
  'search',
  'email',
  'password',
  'tel',
  'url',
  'number',
  'submit',
  'button',
  'reset',
]);

/** How far up to look for the block that lays out an inline element's text. */
const MAX_HOPS = 5;
/** How many items decide whether a list is an Arabic list. */
const LIST_SAMPLE = 30;
/** How much of a block's text is read to judge its language. */
const BLOCK_SAMPLE = 600;
/** A block is only re-aligned when at least this share of its letters is Arabic. */
const ARABIC_MAJORITY = 0.5;

/** Displays where text simply flows, so making the box right-to-left reorders nothing but text. */
const FLOW_DISPLAYS = new Set(['block', 'inline-block', 'flow-root', 'table-cell', '-webkit-box']);
/** A block holding any of these lays out other blocks, not just a run of text. */
const BLOCK_CHILDREN =
  'address,article,aside,blockquote,details,dialog,dd,div,dl,dt,fieldset,figure,footer,form,' +
  'h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,ul';

/** Text fields whose direction should follow what is typed. */
export function isTextField(el: Element): boolean {
  if (el.localName === 'textarea') return true;
  return el.localName === 'input' && DIR_FIELD_TYPES.has((el as HTMLInputElement).type);
}

/**
 * Form controls whose text lives in a value, label or placeholder rather than in
 * child text nodes. They get the font whether or not they hold Arabic right now.
 */
export function isFontField(el: Element): boolean {
  const name = el.localName;
  if (name === 'textarea' || name === 'select') return true;
  return name === 'input' && FONT_FIELD_TYPES.has((el as HTMLInputElement).type);
}

export function isList(el: Element): boolean {
  return LIST_NAMES.has(el.localName);
}

/** The element's `dir` attribute, lower-cased; null when it has none. */
function dirOf(el: Element): string | null {
  return el.getAttribute('dir')?.trim().toLowerCase() ?? null;
}

/**
 * Decides how to fix the direction of the block that lays out `el`'s Arabic text.
 * Read-only: only computed styles and text are inspected. Returns null when the
 * site already handles direction, or the block is not mainly Arabic.
 *
 * `ignoreMarks` re-plans a block Khatt has already marked (used when re-checking
 * with Khatt's own rules switched off).
 */
export function planDirection(
  el: Element,
  style: CSSStyleDeclaration,
  ignoreMarks = false,
): DirectionFix | null {
  let block = el;
  let cs = style;
  let inlineAuto: Element | undefined;
  for (let hops = 0; cs.display === 'inline' || cs.display === 'contents'; hops++) {
    if (!inlineAuto && dirOf(block) === 'auto') inlineAuto = block;
    const parent = block.parentElement;
    if (!parent || hops >= MAX_HOPS) return null;
    block = parent;
    cs = getComputedStyle(block);
  }

  // Never touch the page-level layout.
  if (block === document.body || block === document.documentElement) return null;
  // An explicit dir="ltr" or dir="rtl" is the site's decision and is respected.
  const dir = dirOf(block);
  if (dir !== null && dir !== 'auto') return null;
  if (!ignoreMarks && block.hasAttribute(DIR_ATTR)) return null;
  if (cs.direction === 'rtl') return null;

  // An Arabic word inside an English paragraph, or one Arabic link in a row of links,
  // must not flip the whole block: it has to be mainly Arabic.
  if (arabicShare((block.textContent ?? '').slice(0, BLOCK_SAMPLE)) < ARABIC_MAJORITY) return null;

  // Centered or otherwise deliberately aligned text keeps its alignment.
  const aligned = cs.textAlign !== 'start' && cs.textAlign !== 'left';

  // dir="auto" asks the browser to guess from the first letter alone. A mainly Arabic
  // text that opens with a Latin word ("Claude …") is guessed left-to-right, which
  // scrambles every line. Here the guess is known to be wrong, so it is overridden.
  if (dir === 'auto' || inlineAuto) {
    return { target: block, value: aligned ? 'rtl-bidi' : 'rtl', also: inlineAuto };
  }
  if (aligned) return { target: block, value: 'bidi' };

  if (cs.display === 'list-item') {
    const list = block.parentElement;
    if (list && isList(list) && !list.hasAttribute('dir') && isArabicList(list)) {
      return { target: list, value: 'rtl' };
    }
    // A lone Arabic item in another list: keep its bullet where the list puts it.
    return { target: block, value: 'auto' };
  }

  // A block of running text that is mainly Arabic is right-to-left as a whole, so lines
  // that happen to start with a Latin word or a symbol are not laid out backwards.
  if (FLOW_DISPLAYS.has(cs.display) && !block.querySelector(BLOCK_CHILDREN)) {
    return { target: block, value: 'rtl' };
  }
  // A container of other blocks: direction would be inherited by all of them, so only
  // its own paragraphs are fixed, each by its first letter.
  return { target: block, value: 'auto' };
}

/**
 * A list is flipped as a whole (so its bullets move) when most of its items read
 * right-to-left. Evaluated fresh every time: lists grow while a page loads.
 */
export function isArabicList(list: Element): boolean {
  let items = 0;
  let arabic = 0;
  for (const child of list.children) {
    if (child.localName !== 'li') continue;
    if (++items > LIST_SAMPLE) break;
    if (startsWithArabic((child.textContent ?? '').slice(0, 100))) arabic++;
  }
  return items > 0 && arabic * 2 >= items;
}
