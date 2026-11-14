import { ARABIC_RE } from '@/lib/arabic';
import {
  ATTR,
  AUTO_DIR_ATTR,
  DIR_ATTR,
  JUSTIFY_ATTR,
  lineHeightBucket,
  PROSE_ATTR,
  stripOwnFamily,
} from '@/lib/css';
import type { TransformOptions } from '@/lib/transforms';
import {
  isArabicList,
  isFontField,
  isList,
  isTextField,
  planDirection,
  type DirectionFix,
} from './direction';
import type { StyleManager } from './styles';
import { TextTransformer } from './transforms';

// Element names are compared through localName: tagName is only upper-cased for HTML
// elements in HTML documents, so <style> inside <svg> (or anything in XHTML) is "style".
const SKIP_NAMES = new Set(['script', 'style', 'noscript', 'template', 'pre', 'code', 'kbd', 'samp']);
const SKIP_SELECTOR = 'script,style,noscript,template,pre,code,kbd,samp,[data-khatt-ignore]';
/**
 * Rich-text editors. Their content belongs to the user (and to the editor's own
 * model), so nothing inside is tagged or rewritten — only the editor element itself
 * gets the font, which its content inherits.
 */
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false" i])';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Elements whose Arabic text is running prose and may get a taller line height. */
const PROSE_NAMES = new Set(['p', 'li', 'blockquote', 'dd', 'td']);
/** Any element with at least this much text of its own also counts as prose. */
const PROSE_MIN_CHARS = 80;
/** Alignments that are not a deliberate choice against justification. */
const JUSTIFIABLE = new Set(['start', 'left', 'right', 'end', 'justify']);

/** Main-thread time per slice, and how many elements are tagged per read/write batch. */
const SLICE_MS = 6;
const TAG_BATCH = 250;
/** How many elements are re-checked at a time after the page's stylesheets change. */
const REVALIDATE_CHUNK = 1500;
const REVALIDATE_DELAY_MS = 80;

const OBSERVE: MutationObserverInit = {
  childList: true,
  characterData: true,
  subtree: true,
  // Some libraries (DOM morphing) strip attributes they did not render; re-tag then.
  attributes: true,
  attributeFilter: [ATTR],
};

export interface ScannerOptions extends TransformOptions {
  fixDirection: boolean;
}

interface TagPlan {
  el: Element;
  stack: string;
  heading: boolean;
  prose: number | null;
  justifiable: boolean;
  direction: DirectionFix | null;
  autoDir: boolean;
}

function skipped(el: Element): boolean {
  return SKIP_NAMES.has(el.localName) || el.hasAttribute('data-khatt-ignore');
}

function isEditableRoot(el: Element): boolean {
  const value = el.getAttribute('contenteditable');
  return value !== null && value.toLowerCase() !== 'false';
}

function hasOwnArabicText(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && ARABIC_RE.test((child as Text).data)) return true;
  }
  return false;
}

function isProse(el: Element): boolean {
  if (PROSE_NAMES.has(el.localName)) return true;
  let chars = 0;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) chars += (child as Text).length;
    if (chars >= PROSE_MIN_CHARS) return true;
  }
  return false;
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/**
 * Finds elements that directly contain Arabic text (and form controls and editors,
 * where Arabic may be typed or shown) and tags them: font stack, prose line height,
 * direction fix. Work is sliced so the page stays responsive, a MutationObserver
 * keeps up with dynamically added content, and tags are re-checked when the page's
 * own stylesheets arrive after the fact.
 */
export class Scanner {
  private roots: Node[] = [];
  private walker: TreeWalker | null = null;
  private pending: Element[] = [];
  private shadowRoots = new Set<ShadowRoot>();
  /** Lists Khatt flipped whose items have changed since. */
  private lists = new Set<Element>();
  /** How many stylesheets the page had when each element was tagged. */
  private sheetStamp = new WeakMap<Element, number>();
  /** The block (and any inline dir="auto" wrapper) whose direction was fixed on behalf of each tagged element. */
  private dirTargets = new WeakMap<Element, Element>();
  private dirExtras = new WeakMap<Element, Element>();
  private revalidateTimer: ReturnType<typeof setTimeout> | undefined;
  private scheduled = false;
  private running = false;
  private options: ScannerOptions = { fixDirection: true, hideTashkeel: false, numerals: 'off' };
  private transformer = new TextTransformer(
    (el) => skipped(el) || isFontField(el) || isEditableRoot(el),
    (el) => el.hasAttribute(ATTR),
  );
  private observer = new MutationObserver((records) => this.onMutations(records));

  /** Prunes subtrees that must not be walked; editors are queued for the font on the way. */
  private walkerFilter: NodeFilter = {
    acceptNode: (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (skipped(el)) return NodeFilter.FILTER_REJECT;
      if (isEditableRoot(el)) {
        this.queue(el);
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  };

  private onStylesheetLoad = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLLinkElement && target.relList.contains('stylesheet')) {
      this.requestRevalidate();
    }
  };
  private onDocumentReady = () => this.requestRevalidate();

  constructor(private styles: StyleManager) {}

  /** Direction marks and text rewrites are made while tagging, so a change re-scans the page. */
  setOptions(options: ScannerOptions): void {
    const same =
      options.fixDirection === this.options.fixDirection &&
      options.hideTashkeel === this.options.hideTashkeel &&
      options.numerals === this.options.numerals;
    if (same) return;
    const wasRunning = this.running;
    if (wasRunning) this.stop();
    this.options = { ...options };
    this.transformer.setOptions(options);
    if (wasRunning) this.start();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.observer.observe(document, OBSERVE);
    // `load` does not bubble, but it can be captured: this hears every late stylesheet.
    document.addEventListener('load', this.onStylesheetLoad, true);
    document.addEventListener('DOMContentLoaded', this.onDocumentReady);
    window.addEventListener('load', this.onDocumentReady);
    if (document.documentElement) this.roots.push(document.documentElement);
    this.schedule();
  }

  /** Stops scanning and removes every tag, restoring the page's own fonts, direction and text. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.observer.disconnect();
    document.removeEventListener('load', this.onStylesheetLoad, true);
    document.removeEventListener('DOMContentLoaded', this.onDocumentReady);
    window.removeEventListener('load', this.onDocumentReady);
    clearTimeout(this.revalidateTimer);
    this.roots = [];
    this.walker = null;
    this.pending = [];
    this.lists.clear();
    this.transformer.restoreAll();
    const selector = `[${ATTR}],[${PROSE_ATTR}],[${DIR_ATTR}],[${AUTO_DIR_ATTR}],[${JUSTIFY_ATTR}]`;
    for (const scope of this.scopes()) {
      for (const el of scope.querySelectorAll(selector)) {
        if (el.hasAttribute(AUTO_DIR_ATTR)) {
          el.removeAttribute('dir');
          el.removeAttribute(AUTO_DIR_ATTR);
        }
        el.removeAttribute(ATTR);
        el.removeAttribute(PROSE_ATTR);
        el.removeAttribute(DIR_ATTR);
        el.removeAttribute(JUSTIFY_ATTR);
      }
    }
    for (const root of this.shadowRoots) this.styles.releaseFrom(root);
    this.shadowRoots.clear();
  }

  /** A shadow root was attached to an element that is already on the page. */
  noteShadowHost(host: Element): void {
    if (!this.running || !host.isConnected) return;
    if (skipped(host) || host.closest(SKIP_SELECTOR) || host.closest(EDITABLE_SELECTOR)) return;
    this.adoptShadowRoot(host);
    this.schedule();
  }

  private scopes(): (Document | ShadowRoot)[] {
    return [document, ...this.shadowRoots];
  }

  private onMutations(records: MutationRecord[]): void {
    const added = new Set<Element>();
    for (const record of records) {
      if (record.type === 'attributes') {
        this.recheck(record.target as Element);
        continue;
      }
      if (record.type === 'characterData') {
        if (record.target.nodeType === Node.TEXT_NODE) this.checkLooseText(record.target as Text);
        continue;
      }
      const parent = record.target;
      if (parent.nodeType === Node.ELEMENT_NODE && (parent as Element).getAttribute(DIR_ATTR) === 'rtl') {
        this.lists.add(parent as Element);
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) added.add(node as Element);
        else if (node.nodeType === Node.TEXT_NODE) this.checkLooseText(node as Text);
      }
    }
    for (const el of added) {
      if (!el.isConnected || skipped(el)) continue;
      // A parent added in the same batch will be walked anyway.
      let covered = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (added.has(p)) {
          covered = true;
          break;
        }
      }
      if (!covered) this.roots.push(el);
    }
    // The page may have removed Khatt's stylesheet; the next pass puts it back.
    if (this.hasWork() || !this.styles.attached) this.schedule();
  }

  /** Our tag changed. If something else removed it from an element that still needs it, tag again. */
  private recheck(el: Element): void {
    if (el.hasAttribute(ATTR) || !el.isConnected) return;
    if (isEditableRoot(el)) {
      this.pending.push(el);
      return;
    }
    if (el.closest(SKIP_SELECTOR) || el.closest(EDITABLE_SELECTOR)) return;
    if (isFontField(el) || hasOwnArabicText(el)) this.pending.push(el);
  }

  /** A text node that appeared or changed outside a subtree walk. */
  private checkLooseText(text: Text): void {
    const parent = text.parentElement;
    if (!parent) return;

    if (!ARABIC_RE.test(text.data)) {
      // Pages reuse elements: text that was Arabic may now be something else, and the
      // element must not keep Arabic spacing and alignment. Our own rewrites (Arabic-Indic
      // digits turned Western) are not such a change.
      if (
        parent.hasAttribute(ATTR) &&
        !this.transformer.isOwnWrite(text) &&
        !isFontField(parent) &&
        !isEditableRoot(parent) &&
        !hasOwnArabicText(parent)
      ) {
        this.untag(parent);
      }
      return;
    }

    const editor = parent.closest(EDITABLE_SELECTOR);
    if (editor) {
      // Typing in an editor: only make sure the editor itself has the font.
      this.queue(editor);
      return;
    }
    if (parent.hasAttribute(ATTR)) {
      // Our own rewrites land here too; the transformer recognises and ignores them.
      this.transformer.applyToText(text, parent);
      return;
    }
    if (parent.closest(SKIP_SELECTOR)) return;
    this.pending.push(parent);
  }

  /** Takes Khatt's marks off one element and puts its own text back. */
  private untag(el: Element): void {
    this.transformer.restoreIn(el);
    el.removeAttribute(ATTR);
    el.removeAttribute(PROSE_ATTR);
    el.removeAttribute(JUSTIFY_ATTR);
    this.sheetStamp.delete(el);
    this.dirTargets.delete(el);
    this.dirExtras.delete(el);
  }

  private queue(el: Element): void {
    if (!el.hasAttribute(ATTR)) this.pending.push(el);
  }

  private schedule(): void {
    if (this.scheduled || !this.running) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      this.work();
    };
    // rAF applies fonts before the next paint; hidden tabs don't fire it.
    if (document.hidden) setTimeout(run, 50);
    else requestAnimationFrame(run);
  }

  private work(): void {
    if (!this.running) return;
    // A whole-document editor: leave it entirely alone.
    if (document.designMode === 'on') {
      this.roots = [];
      this.walker = null;
      this.pending = [];
      this.lists.clear();
      return;
    }
    this.reviewLists();
    const deadline = performance.now() + SLICE_MS;
    do {
      this.walkSlice(deadline);
      this.tagBatch();
    } while (this.hasWork() && performance.now() < deadline);
    this.styles.flush();
    if (this.hasWork()) this.schedule();
  }

  private hasWork(): boolean {
    return (
      this.walker !== null || this.roots.length > 0 || this.pending.length > 0 || this.lists.size > 0
    );
  }

  /**
   * A list flipped to right-to-left is judged by its items, and items come and go.
   * When it is no longer mostly Arabic the flip is undone and its Arabic items are
   * planned again one by one.
   */
  private reviewLists(): void {
    for (const list of this.lists) {
      if (!list.isConnected || list.getAttribute(DIR_ATTR) !== 'rtl') continue;
      if (!isList(list) || isArabicList(list)) continue;
      list.removeAttribute(DIR_ATTR);
      for (const el of list.querySelectorAll(`[${ATTR}]`)) {
        if (isFontField(el) || isEditableRoot(el)) continue;
        this.untag(el);
        this.pending.push(el);
      }
    }
    this.lists.clear();
  }

  private walkSlice(deadline: number): void {
    let steps = 0;
    while (true) {
      if (!this.walker) {
        const root = this.roots.shift();
        if (!root) return;
        if (!root.isConnected) continue;
        if (root.nodeType === Node.ELEMENT_NODE) {
          const el = root as Element;
          if (el.closest(SKIP_SELECTOR)) continue;
          const editor = el.closest(EDITABLE_SELECTOR);
          if (editor) {
            this.queue(editor);
            continue;
          }
          this.visitElement(el);
        }
        this.walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
          this.walkerFilter,
        );
      }
      let node: Node | null;
      while ((node = this.walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (ARABIC_RE.test((node as Text).data)) {
            const parent = node.parentElement;
            if (parent) {
              if (parent.hasAttribute(ATTR)) this.transformer.applyToText(node as Text, parent);
              else this.pending.push(parent);
            }
          }
        } else {
          this.visitElement(node as Element);
        }
        if (++steps % 64 === 0 && performance.now() >= deadline) return;
      }
      this.walker = null;
    }
  }

  private visitElement(el: Element): void {
    // Form controls are tagged even when empty: their text is a value, label or
    // placeholder rather than a text node, and Arabic may be typed later.
    if (isFontField(el)) this.queue(el);
    this.adoptShadowRoot(el);
  }

  private adoptShadowRoot(host: Element): void {
    const root = host.shadowRoot;
    if (!root || this.shadowRoots.has(root)) return;
    this.shadowRoots.add(root);
    this.styles.adoptInto(root);
    this.observer.observe(root, OBSERVE);
    this.roots.push(root);
  }

  /** Changes whenever the page gains or loses a stylesheet. */
  private stylesheetStamp(): number {
    return document.styleSheets.length + (document.adoptedStyleSheets?.length ?? 0);
  }

  /** Reads everything needed to tag `el`. Makes no changes. */
  private planFor(el: Element, ignoreMarks: boolean): TagPlan | null {
    const cs = getComputedStyle(el);
    const stack = stripOwnFamily(cs.fontFamily);
    if (!stack) return null;
    const textField = isTextField(el);
    // Form controls, editors and SVG text get the font only: no layout, direction-by-CSS or text changes.
    const fontOnly = isFontField(el) || isEditableRoot(el) || el.namespaceURI !== HTML_NS;
    const prose = !fontOnly && isProse(el);
    return {
      el,
      stack,
      heading: !fontOnly && el.closest('h1,h2,h3,h4,h5,h6') !== null,
      prose: prose ? lineHeightBucket(cs.lineHeight, cs.fontSize) : null,
      justifiable:
        prose && cs.display !== 'inline' && cs.display !== 'contents' && JUSTIFIABLE.has(cs.textAlign),
      direction:
        this.options.fixDirection && !fontOnly ? planDirection(el, cs, ignoreMarks) : null,
      autoDir:
        this.options.fixDirection && textField && !el.hasAttribute('dir') && cs.direction !== 'rtl',
    };
  }

  /** Writes a plan's attributes. `replace` also takes away marks the plan no longer calls for. */
  private applyPlan(plan: TagPlan, stamp: number, replace: boolean): void {
    const { el } = plan;
    setAttr(el, ATTR, this.styles.stackId(plan.stack, plan.heading));
    if (plan.prose !== null) setAttr(el, PROSE_ATTR, String(plan.prose));
    else if (replace) setAttr(el, PROSE_ATTR, null);
    if (plan.justifiable) setAttr(el, JUSTIFY_ATTR, '');
    else if (replace) setAttr(el, JUSTIFY_ATTR, null);

    if (plan.direction) {
      const { target, value } = plan.direction;
      if (replace || !target.hasAttribute(DIR_ATTR)) setAttr(target, DIR_ATTR, value);
      this.dirTargets.set(el, target);
      const { also } = plan.direction;
      if (also) {
        setAttr(also, DIR_ATTR, 'rtl-bidi');
        this.dirExtras.set(el, also);
      }
    }
    if (plan.autoDir) {
      el.setAttribute('dir', 'auto');
      el.setAttribute(AUTO_DIR_ATTR, '');
    }
    this.sheetStamp.set(el, stamp);
  }

  /** Reads all computed styles first, then writes all attributes, to avoid layout thrash. */
  private tagBatch(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, TAG_BATCH);
    const stamp = this.stylesheetStamp();

    const plans: TagPlan[] = [];
    for (const el of batch) {
      if (!el.isConnected || el.hasAttribute(ATTR)) continue;
      const plan = this.planFor(el, false);
      if (plan) plans.push(plan);
    }
    for (const plan of plans) {
      this.applyPlan(plan, stamp, false);
      this.transformer.applyTo(plan.el);
    }
  }

  private requestRevalidate(): void {
    if (!this.running) return;
    clearTimeout(this.revalidateTimer);
    this.revalidateTimer = setTimeout(() => this.revalidate(), REVALIDATE_DELAY_MS);
  }

  /**
   * Tagging starts before the page's stylesheets have necessarily loaded (always so in
   * a background tab), and what is recorded then — the element's font stack, line
   * height, alignment — would be the browser's defaults, pinned in place by Khatt's
   * own rules. Elements tagged under an older set of stylesheets are measured again
   * here, with Khatt's rules switched off for the measurement.
   */
  private revalidate(): void {
    if (!this.running) return;
    const stamp = this.stylesheetStamp();
    const stale: Element[] = [];
    for (const scope of this.scopes()) {
      for (const el of scope.querySelectorAll(`[${ATTR}]`)) {
        if (this.sheetStamp.get(el) !== stamp) stale.push(el);
      }
    }
    if (stale.length) this.revalidateChunk(stale, 0, stamp);
  }

  private revalidateChunk(stale: Element[], from: number, stamp: number): void {
    if (!this.running) return;
    const chunk = stale
      .slice(from, from + REVALIDATE_CHUNK)
      .filter((el) => el.isConnected && el.hasAttribute(ATTR));

    // Off and back on within one task: nothing is painted in between.
    let plans: (TagPlan | null)[];
    this.styles.setDisabled(true);
    try {
      plans = chunk.map((el) => this.planFor(el, true));
    } finally {
      this.styles.setDisabled(false);
    }

    // Take away direction fixes that no longer apply, then write the fresh plans.
    chunk.forEach((el, i) => {
      const previous = this.dirTargets.get(el);
      if (previous && plans[i]?.direction?.target !== previous) {
        previous.removeAttribute(DIR_ATTR);
        this.dirTargets.delete(el);
      }
      const extra = this.dirExtras.get(el);
      if (extra && plans[i]?.direction?.also !== extra) {
        extra.removeAttribute(DIR_ATTR);
        this.dirExtras.delete(el);
      }
    });
    for (const plan of plans) if (plan) this.applyPlan(plan, stamp, true);
    this.styles.flush();

    const next = from + REVALIDATE_CHUNK;
    if (next < stale.length) {
      this.revalidateTimer = setTimeout(() => this.revalidateChunk(stale, next, stamp), 0);
    }
  }
}
