import { startsWithArabic } from '@/lib/arabic';
import { DIR_ATTR } from '@/lib/css';

export interface DirectionFix {
  target: Element;
  value: 'auto' | 'bidi' | 'rtl';
}

const LIST_TAGS = new Set(['UL', 'OL', 'MENU']);
/** How far up to look for the block that lays out an inline element's text. */
const MAX_HOPS = 5;
/** How many items decide whether a list is an Arabic list. */
const LIST_SAMPLE = 30;

const evaluatedLists = new WeakMap<Element, boolean>();

/** Text fields whose direction should follow what is typed. */
export function isTextField(el: Element): boolean {
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type === 'text' || type === 'search';
}

/**
 * Decides how to fix the direction of the block that lays out `el`'s Arabic text.
 * Read-only: only computed styles and text are inspected. Returns null when the
 * site already handles direction.
 */
export function planDirection(el: Element, style: CSSStyleDeclaration): DirectionFix | null {
  let block = el;
  let cs = style;
  for (let hops = 0; cs.display === 'inline' || cs.display === 'contents'; hops++) {
    const parent = block.parentElement;
    if (!parent || hops >= MAX_HOPS) return null;
    block = parent;
    cs = getComputedStyle(block);
  }

  // Never touch the page-level layout.
  if (block === document.body || block === document.documentElement) return null;
  if (block.hasAttribute(DIR_ATTR) || block.hasAttribute('dir')) return null;
  if (cs.direction === 'rtl') return null;
  // Centered or otherwise deliberately aligned text keeps its alignment.
  if (cs.textAlign !== 'start' && cs.textAlign !== 'left') return { target: block, value: 'bidi' };

  if (cs.display === 'list-item') {
    const list = block.parentElement;
    if (list && LIST_TAGS.has(list.tagName) && isArabicList(list)) {
      return { target: list, value: 'rtl' };
    }
  }
  return { target: block, value: 'auto' };
}

/** A list is flipped as a whole (so its bullets move) when most of its items read right-to-left. */
function isArabicList(list: Element): boolean {
  if (list.hasAttribute('dir')) return false;
  const known = evaluatedLists.get(list);
  if (known !== undefined) return known;

  let items = 0;
  let arabic = 0;
  for (const child of list.children) {
    if (child.tagName !== 'LI') continue;
    if (++items > LIST_SAMPLE) break;
    if (startsWithArabic((child.textContent ?? '').slice(0, 100))) arabic++;
  }
  const result = items > 0 && arabic * 2 >= items;
  evaluatedLists.set(list, result);
  return result;
}
