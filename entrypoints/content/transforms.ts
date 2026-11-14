import { ARABIC_RE } from '@/lib/arabic';
import { hasTransforms, transformText, type TransformOptions } from '@/lib/transforms';
import { isTextField } from './direction';

/**
 * Reversible text rewriting (hide tashkeel, convert numerals). The original string
 * of every rewritten text node is kept so it can be put back exactly. Text fields
 * and editable regions are never rewritten.
 */
export class TextTransformer {
  private originals = new WeakMap<Text, string>();
  /** What we last wrote, to tell our own edits from the page's. */
  private written = new WeakMap<Text, string>();
  private options: TransformOptions = { hideTashkeel: false, numerals: 'off' };

  setOptions(options: TransformOptions): void {
    this.options = { ...options };
  }

  get active(): boolean {
    return hasTransforms(this.options);
  }

  /** Rewrites the Arabic text nodes directly inside a tagged element. */
  applyTo(el: Element): void {
    if (!this.active || !rewritable(el)) return;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) this.rewrite(child as Text);
    }
  }

  /** Rewrites one text node that appeared or changed inside an already tagged element. */
  applyToText(text: Text, parent: Element): void {
    if (this.active && rewritable(parent)) this.rewrite(text);
  }

  /** Puts back the original text of the nodes directly inside `el`. */
  restoreIn(el: Element): void {
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const text = child as Text;
      const original = this.originals.get(text);
      if (original === undefined) continue;
      // If the page has since replaced the text, its version wins.
      if (this.written.get(text) === text.data) text.data = original;
      this.originals.delete(text);
      this.written.delete(text);
    }
  }

  private rewrite(text: Text): void {
    const current = text.data;
    let original = this.originals.get(text);
    // The page changed the text after we rewrote it: start again from its version.
    if (original !== undefined && this.written.get(text) !== current) original = undefined;
    original ??= current;
    if (!ARABIC_RE.test(original)) return;

    const next = transformText(original, this.options);
    if (next === original) {
      this.originals.delete(text);
      this.written.delete(text);
      return;
    }
    this.originals.set(text, original);
    this.written.set(text, next);
    if (next !== current) text.data = next;
  }
}

function rewritable(el: Element): boolean {
  return !isTextField(el) && !(el as HTMLElement).isContentEditable;
}
