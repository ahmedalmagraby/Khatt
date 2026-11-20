import { ARABIC_RE } from '@/lib/arabic';
import {
  hasTransforms,
  isNumericOnly,
  transformText,
  type TransformOptions,
} from '@/lib/transforms';

/** Beyond this many remembered nodes, entries for nodes that no longer exist are dropped. */
const COMPACT_AT = 4000;

/**
 * Reversible text rewriting (hide tashkeel, convert numerals). The original string
 * of every rewritten text node is kept so it can be put back exactly. Form fields,
 * editors and code are never rewritten — `offLimits` says which elements those are.
 */
export class TextTransformer {
  private originals = new WeakMap<Text, string>();
  /** What we last wrote, to tell our own edits from the page's. */
  private written = new WeakMap<Text, string>();
  /** Every node currently rewritten, so all of them can be restored. */
  private rewritten = new Set<WeakRef<Text>>();
  private options: TransformOptions = { hideTashkeel: false, numerals: 'off' };

  constructor(
    private offLimits: (el: Element) => boolean,
    /** Elements that are tagged themselves and so rewrite their own text. */
    private isTagged: (el: Element) => boolean,
  ) {}

  setOptions(options: TransformOptions): void {
    this.options = { ...options };
  }

  get active(): boolean {
    return hasTransforms(this.options);
  }

  /** Rewrites the text of a tagged element: its own text nodes, and bare numbers nested inside it. */
  applyTo(el: Element): void {
    if (!this.active || !this.rewritable(el)) return;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) this.rewrite(child as Text);
    }
    if (this.options.numerals !== 'off') this.rewriteNestedNumbers(el);
  }

  /** Rewrites one text node that appeared or changed inside an already tagged element. */
  applyToText(text: Text, parent: Element): void {
    if (this.active && this.rewritable(parent)) this.rewrite(text);
  }

  /**
   * A text node without Arabic that appeared or changed. If it is a bare number and
   * the nearest element around it that rewrites text is a tagged one, it follows the
   * numeral setting like the numbers that were there when that element was tagged.
   */
  applyToNumber(text: Text): void {
    if (this.options.numerals === 'off' || !isNumericOnly(text.data)) return;
    for (let el = text.parentElement; el; el = el.parentElement) {
      if (!this.rewritable(el)) return;
      if (this.isTagged(el)) {
        this.rewrite(text);
        return;
      }
    }
  }

  /** True when `text` currently holds exactly what we wrote into it. */
  isOwnWrite(text: Text): boolean {
    return this.written.get(text) === text.data;
  }

  /** Puts back the original text of the nodes directly inside `el`, and of the bare numbers nested in it. */
  restoreIn(el: Element): void {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) this.restore(child as Text);
    }
    // Only numbers rewritten on behalf of `el`: the same nodes rewriteNestedNumbers
    // reaches. Text under tagged descendants belongs to those elements.
    const walker = this.nestedWalker(el);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType !== Node.TEXT_NODE || node.parentNode === el) continue;
      const original = this.originals.get(node as Text);
      if (original !== undefined && isNumericOnly(original)) this.restore(node as Text);
    }
  }

  /** Puts back every rewritten node anywhere inside `el`, whoever rewrote it (it became an editor). */
  restoreSubtree(el: Element): void {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) this.restore(node as Text);
  }

  /** Puts back every rewritten node on the page. */
  restoreAll(): void {
    for (const ref of this.rewritten) {
      const text = ref.deref();
      if (text) this.restore(text);
    }
    this.rewritten.clear();
  }

  /**
   * A number often sits in its own inline element inside Arabic text
   * (`عام <b>2024</b>`), where that element has no Arabic of its own and is never
   * tagged. Such bare numbers follow the numeral setting of the text around them.
   */
  private rewriteNestedNumbers(el: Element): void {
    const walker = this.nestedWalker(el);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType !== Node.TEXT_NODE || node.parentNode === el) continue;
      if (isNumericOnly((node as Text).data)) this.rewrite(node as Text);
    }
  }

  /** Walks `el` without entering tagged descendants (they handle their own text) or off-limits ones. */
  private nestedWalker(el: Element): TreeWalker {
    return document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (this.offLimits(node as Element) || this.isTagged(node as Element))
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
  }

  private rewritable(el: Element): boolean {
    return !this.offLimits(el) && !(el as HTMLElement).isContentEditable;
  }

  private restore(text: Text): void {
    const original = this.originals.get(text);
    if (original === undefined) return;
    // If the page has since replaced the text, its version wins.
    if (this.written.get(text) === text.data) text.data = original;
    this.originals.delete(text);
    this.written.delete(text);
  }

  private rewrite(text: Text): void {
    const current = text.data;
    let original = this.originals.get(text);
    // The page changed the text after we rewrote it: start again from its version.
    if (original !== undefined && this.written.get(text) !== current) original = undefined;
    original ??= current;
    // Arabic text, or a bare number living among Arabic text.
    if (!ARABIC_RE.test(original) && !isNumericOnly(original)) return;

    const next = transformText(original, this.options);
    if (next === original) {
      this.originals.delete(text);
      this.written.delete(text);
      return;
    }
    const firstTime = !this.originals.has(text);
    this.originals.set(text, original);
    this.written.set(text, next);
    if (firstTime) this.remember(text);
    if (next !== current) text.data = next;
  }

  private remember(text: Text): void {
    this.rewritten.add(new WeakRef(text));
    if (this.rewritten.size < COMPACT_AT) return;
    for (const ref of this.rewritten) {
      const node = ref.deref();
      if (!node || !this.originals.has(node)) this.rewritten.delete(ref);
    }
  }
}
