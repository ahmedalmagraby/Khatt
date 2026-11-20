import { ARABIC_RE } from '@/lib/arabic';
import {
  ATTR,
  AUTO_DIR_ATTR,
  DIR_ATTR,
  JUSTIFY_ATTR,
  lineHeightBucket,
  PLAIN_ATTR,
  PROSE_ATTR,
  stripOwnFamily,
} from '@/lib/css';
import { isNumericOnly, type TransformOptions } from '@/lib/transforms';
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
const SKIP_NAMES = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'pre',
  'code',
  'kbd',
  'samp',
  'datalist',
]);
const SKIP_SELECTOR = 'script,style,noscript,template,pre,code,kbd,samp,datalist,[data-khatt-ignore]';
/**
 * Rich-text editors. Their content belongs to the user (and to the editor's own
 * model), so nothing inside is tagged or rewritten — only the editor element itself
 * gets the font, which its content inherits.
 */
const EDITABLE_SELECTOR =
  '[contenteditable=""],[contenteditable="true" i],[contenteditable="plaintext-only" i]';
/** contenteditable values that make an editor; any other value (a typo, "inherit") does not. */
const EDITABLE_VALUES = new Set(['', 'true', 'plaintext-only']);
/**
 * Editors, and the controls whose child nodes are a value rather than page text: an
 * <option>'s text is what the form submits, a <textarea>'s is its initial value.
 * Like editors, they get the font themselves and nothing inside them is touched.
 */
const OWNER_SELECTOR = `${EDITABLE_SELECTOR},select,textarea`;
/** Blocks Khatt made right-to-left; text fields inside inherit that direction from Khatt, not the site. */
const FLIPPED_SELECTOR = `[${DIR_ATTR}="rtl"],[${DIR_ATTR}="rtl-bidi"]`;
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Elements whose Arabic text is running prose and may get a taller line height. */
const PROSE_NAMES = new Set(['p', 'li', 'blockquote', 'dd', 'td']);
/** Any element with at least this much text of its own also counts as prose. */
const PROSE_MIN_CHARS = 80;
/** Alignments that are not a deliberate choice against justification. */
const JUSTIFIABLE = new Set(['start', 'left', 'right', 'end', 'justify']);

/** Main-thread time per slice. */
const SLICE_MS = 6;
/**
 * How many elements are tagged per read/write batch: as many as the slice has time
 * left for, within these bounds (the lower one keeps a slow page moving).
 */
const TAG_BATCH_MIN = 32;
const TAG_BATCH_MAX = 250;
/** How many elements are re-checked at a time after the page's stylesheets change. */
const REVALIDATE_CHUNK = 400;
const REVALIDATE_DELAY_MS = 80;
/**
 * Pages that strip Khatt's tag get it back (DOM morphing libraries do this on every
 * render). One that strips it again at once, over and over, would keep both sides busy
 * every frame: past this many strips of one element within a second, re-tagging it
 * waits, longer each time.
 */
const STRIP_WINDOW_MS = 1000;
const STRIP_LIMIT = 15;
const STRIP_BACKOFF_MIN_MS = 2000;
const STRIP_BACKOFF_MAX_MS = 60000;

const OBSERVE: MutationObserverInit = {
  childList: true,
  characterData: true,
  subtree: true,
  // Some libraries (DOM morphing) strip attributes they did not render; re-tag then.
  // An element that becomes (or stops being) an editor is handled anew.
  attributes: true,
  attributeFilter: [ATTR, 'contenteditable'],
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
  plain: boolean;
}

function skipped(el: Element): boolean {
  return SKIP_NAMES.has(el.localName) || el.hasAttribute('data-khatt-ignore');
}

function isEditableRoot(el: Element): boolean {
  const value = el.getAttribute('contenteditable');
  return value !== null && EDITABLE_VALUES.has(value.trim().toLowerCase());
}

/** True for elements that are tagged for the font alone and own everything inside them. */
function ownsContent(el: Element): boolean {
  return isEditableRoot(el) || el.localName === 'select' || el.localName === 'textarea';
}

/** Form controls, editors and SVG text get the font only: no layout, direction-by-CSS or text changes. */
function fontOnly(el: Element): boolean {
  return isFontField(el) || isEditableRoot(el) || el.namespaceURI !== HTML_NS;
}

/** Whether a form control or editor shows any Arabic right now. Passwords are not read. */
function holdsArabic(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    return ARABIC_RE.test(el.placeholder) || (el.type !== 'password' && ARABIC_RE.test(el.value));
  }
  if (el instanceof HTMLTextAreaElement) {
    return ARABIC_RE.test(el.placeholder) || ARABIC_RE.test(el.value);
  }
  return ARABIC_RE.test(el.textContent ?? '');
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
  /** How often the page has stripped each element's tag lately (see STRIP_LIMIT). */
  private strips = new WeakMap<Element, { since: number; count: number; backoff: number; until: number }>();
  /** Elements whose re-tagging waits out a back-off, and the timer that brings them back. */
  private deferred = new Set<Element>();
  private deferTimer: ReturnType<typeof setTimeout> | undefined;
  /** Lists Khatt flipped whose items have changed since. */
  private lists = new Set<Element>();
  /** Tagged elements whose direction fix has to be worked out again. */
  private redirect = new Set<Element>();
  /** Which generation of the page's stylesheets each element was tagged under. */
  private sheetStamp = new WeakMap<Element, number>();
  /** The page's stylesheets as last seen, and a counter that moves whenever they change. */
  private sheets: CSSStyleSheet[] = [];
  private sheetCount = -1;
  private sheetGeneration = 0;
  /** The block (and any inline dir="auto" wrapper) whose direction was fixed on behalf of each tagged element. */
  private dirTargets = new WeakMap<Element, Element>();
  private dirExtras = new WeakMap<Element, Element>();
  private revalidateTimer: ReturnType<typeof setTimeout> | undefined;
  private scheduled = false;
  private running = false;
  private options: ScannerOptions = { fixDirection: true, hideTashkeel: false, numerals: 'off' };
  private transformer = new TextTransformer(
    (el) => skipped(el) || isFontField(el) || ownsContent(el) || el.localName === 'option',
    (el) => el.hasAttribute(ATTR),
  );
  private observer = new MutationObserver((records) => this.onMutations(records));

  /** Prunes subtrees that must not be walked; editors and controls are queued for the font on the way. */
  private walkerFilter: NodeFilter = {
    acceptNode: (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (skipped(el)) return NodeFilter.FILTER_REJECT;
      if (ownsContent(el)) {
        this.queue(el);
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  };

  /** Typing changes whether a field holds Arabic, and with it whether its spacing is the site's. */
  private onInput = (event: Event) => {
    const target = event.composedPath()[0];
    if (target instanceof Element && target.hasAttribute(ATTR) && isFontField(target)) {
      setAttr(target, PLAIN_ATTR, holdsArabic(target) ? null : '');
    }
  };

  private onStylesheetLoad = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLLinkElement && target.relList.contains('stylesheet')) {
      this.requestRevalidate();
    }
  };
  private onDocumentReady = () => this.requestRevalidate();

  constructor(private styles: StyleManager) {}

  /**
   * Direction marks and text rewrites are made while tagging. A change redoes just
   * those on the elements already tagged; their fonts stay on throughout.
   */
  setOptions(options: ScannerOptions): void {
    const text =
      options.hideTashkeel !== this.options.hideTashkeel || options.numerals !== this.options.numerals;
    const direction = options.fixDirection !== this.options.fixDirection;
    if (!text && !direction) return;
    this.options = { ...options };

    if (text) {
      if (this.running) this.transformer.restoreAll();
      this.transformer.setOptions(options);
      if (this.running) for (const el of this.tagged()) this.transformer.applyTo(el);
    }
    if (direction && this.running) {
      if (options.fixDirection) {
        // Plan every tagged element again, as after a stylesheet change.
        this.sheetStamp = new WeakMap();
        clearTimeout(this.revalidateTimer);
        this.revalidate();
      } else {
        this.clearDirection();
      }
    }
  }

  /** Every tagged element, in the document and in shadow roots. */
  private tagged(): Element[] {
    return this.scopes().flatMap((scope) => [...scope.querySelectorAll(`[${ATTR}]`)]);
  }

  /** Takes back every direction fix, leaving fonts and spacing in place. */
  private clearDirection(): void {
    this.lists.clear();
    this.redirect.clear();
    this.dirTargets = new WeakMap();
    this.dirExtras = new WeakMap();
    for (const scope of this.scopes()) {
      for (const el of scope.querySelectorAll(`[${DIR_ATTR}],[${AUTO_DIR_ATTR}]`)) {
        if (el.hasAttribute(AUTO_DIR_ATTR)) {
          el.removeAttribute('dir');
          el.removeAttribute(AUTO_DIR_ATTR);
        }
        el.removeAttribute(DIR_ATTR);
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.observer.observe(document, OBSERVE);
    // `load` does not bubble, but it can be captured: this hears every late stylesheet.
    document.addEventListener('load', this.onStylesheetLoad, true);
    document.addEventListener('DOMContentLoaded', this.onDocumentReady);
    window.addEventListener('load', this.onDocumentReady);
    document.addEventListener('input', this.onInput, true);
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
    document.removeEventListener('input', this.onInput, true);
    clearTimeout(this.revalidateTimer);
    clearTimeout(this.deferTimer);
    this.deferTimer = undefined;
    this.deferred.clear();
    this.strips = new WeakMap();
    this.roots = [];
    this.walker = null;
    this.pending = [];
    this.lists.clear();
    this.redirect.clear();
    this.dirTargets = new WeakMap();
    this.dirExtras = new WeakMap();
    this.sheetStamp = new WeakMap();
    this.sheets = [];
    this.sheetCount = -1;
    this.transformer.restoreAll();
    const selector = `[${ATTR}],[${PLAIN_ATTR}],[${PROSE_ATTR}],[${DIR_ATTR}],[${AUTO_DIR_ATTR}],[${JUSTIFY_ATTR}]`;
    for (const scope of this.scopes()) {
      for (const el of scope.querySelectorAll(selector)) {
        if (el.hasAttribute(AUTO_DIR_ATTR)) {
          el.removeAttribute('dir');
          el.removeAttribute(AUTO_DIR_ATTR);
        }
        el.removeAttribute(ATTR);
        el.removeAttribute(PLAIN_ATTR);
        el.removeAttribute(PROSE_ATTR);
        el.removeAttribute(DIR_ATTR);
        el.removeAttribute(JUSTIFY_ATTR);
      }
    }
    for (const root of this.shadowRoots) {
      root.removeEventListener('load', this.onStylesheetLoad, true);
      this.styles.releaseFrom(root);
    }
    this.shadowRoots.clear();
  }

  /** A shadow root was attached to an element that is already on the page. */
  noteShadowHost(host: Element): void {
    if (!this.running || !host.isConnected) return;
    if (skipped(host) || host.closest(SKIP_SELECTOR) || host.closest(OWNER_SELECTOR)) return;
    this.adoptShadowRoot(host);
    this.schedule();
  }

  /**
   * The document and the shadow roots whose hosts are on the page. Roots whose host has
   * left are let go, so pages that create and drop many components do not keep them
   * all alive; a host that comes back is adopted again when it is walked.
   */
  private scopes(): (Document | ShadowRoot)[] {
    const scopes: (Document | ShadowRoot)[] = [document];
    for (const root of this.shadowRoots) {
      if (root.host.isConnected) {
        scopes.push(root);
      } else {
        this.shadowRoots.delete(root);
        root.removeEventListener('load', this.onStylesheetLoad, true);
      }
    }
    return scopes;
  }

  private onMutations(records: MutationRecord[]): void {
    const added = new Set<Element>();
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.attributeName === ATTR) this.recheck(record.target as Element);
        else this.editableChanged(record.target as Element);
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
      if (record.removedNodes.length > 0) {
        if (parent.nodeType === Node.ELEMENT_NODE) {
          this.checkEmptied(parent as Element);
          this.checkEditorPlain(parent as Element);
        }
        for (const node of record.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) this.noteRemoved(node as Element);
        }
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
    if (el.closest(SKIP_SELECTOR)) return;
    const owner = el.closest(OWNER_SELECTOR);
    if (owner) {
      if (owner === el) this.retag(el);
      return;
    }
    if (isFontField(el) || hasOwnArabicText(el)) this.retag(el);
  }

  /** Re-tags an element the page stripped, unless it keeps doing so at once (see STRIP_LIMIT). */
  private retag(el: Element): void {
    const now = performance.now();
    let s = this.strips.get(el);
    if (!s) this.strips.set(el, (s = { since: now, count: 0, backoff: 0, until: 0 }));
    if (now < s.until) {
      this.defer(el, s.until - now);
      return;
    }
    if (now - s.since > STRIP_WINDOW_MS) {
      s.since = now;
      s.count = 0;
    }
    if (++s.count > STRIP_LIMIT) {
      s.backoff = Math.min(Math.max(s.backoff * 2, STRIP_BACKOFF_MIN_MS), STRIP_BACKOFF_MAX_MS);
      s.until = now + s.backoff;
      s.since = s.until;
      s.count = 0;
      this.defer(el, s.backoff);
      return;
    }
    this.pending.push(el);
  }

  private defer(el: Element, delay: number): void {
    this.deferred.add(el);
    if (this.deferTimer !== undefined) return;
    this.deferTimer = setTimeout(() => {
      this.deferTimer = undefined;
      const els = [...this.deferred];
      this.deferred.clear();
      for (const d of els) this.recheck(d);
      if (this.hasWork()) this.schedule();
    }, delay);
  }

  /**
   * An element's contenteditable changed. Becoming an editor, its content is the
   * user's now: text Khatt rewrote must not be saved by the site, so it is put back,
   * every mark inside comes off, and the editor is tagged for the font alone. Ceasing
   * to be one, it is plain page content and is walked again.
   */
  private editableChanged(el: Element): void {
    if (!el.isConnected || el.closest(SKIP_SELECTOR)) return;
    if (isEditableRoot(el)) {
      this.transformer.restoreSubtree(el);
      const marked = `[${ATTR}],[${PLAIN_ATTR}],[${PROSE_ATTR}],[${DIR_ATTR}],[${AUTO_DIR_ATTR}],[${JUSTIFY_ATTR}]`;
      for (const inner of el.querySelectorAll(marked)) this.clearMarks(inner);
      this.clearMarks(el);
      this.queue(el.parentElement?.closest(OWNER_SELECTOR) ?? el);
    } else {
      if (el.hasAttribute(ATTR)) this.untag(el);
      el.removeAttribute(PLAIN_ATTR);
      this.roots.push(el);
    }
  }

  /** Every mark Khatt may have put on `el`, with its rewritten text and the direction fixes made for it. */
  private clearMarks(el: Element): void {
    if (el.hasAttribute(ATTR)) this.untag(el);
    if (el.hasAttribute(AUTO_DIR_ATTR)) {
      el.removeAttribute('dir');
      el.removeAttribute(AUTO_DIR_ATTR);
    }
    el.removeAttribute(PLAIN_ATTR);
    el.removeAttribute(PROSE_ATTR);
    el.removeAttribute(DIR_ATTR);
    el.removeAttribute(JUSTIFY_ATTR);
  }

  /** Text was removed inside an editor: once no Arabic is left, it keeps the site's spacing again. */
  private checkEditorPlain(el: Element): void {
    const editor = el.closest(EDITABLE_SELECTOR);
    if (editor) this.refreshPlain(editor);
  }

  private refreshPlain(editor: Element): void {
    if (editor.hasAttribute(ATTR) && !editor.hasAttribute(PLAIN_ATTR) && !holdsArabic(editor)) {
      setAttr(editor, PLAIN_ATTR, '');
    }
  }

  /**
   * Nodes were removed from `el`. If that took away the Arabic text it was tagged for
   * (the page emptied it, or swapped its text for other elements), the tag goes too.
   */
  private checkEmptied(el: Element): void {
    if (el.hasAttribute(ATTR) && !fontOnly(el) && !hasOwnArabicText(el)) this.untag(el);
  }

  /**
   * A subtree left the page (or is being moved). Direction fixes its tagged elements
   * had placed on blocks that stay behind are taken back, and worked out again where
   * the elements land if they return.
   */
  private noteRemoved(root: Element): void {
    const tagged = [...root.querySelectorAll(`[${ATTR}]`)];
    if (root.hasAttribute(ATTR)) tagged.push(root);
    for (const el of tagged) {
      const target = this.dirTargets.get(el);
      const extra = this.dirExtras.get(el);
      if ((target && !root.contains(target)) || (extra && !root.contains(extra))) {
        this.releaseDirection(el);
        this.redirect.add(el);
      }
    }
  }

  /**
   * A bare number Khatt itself wrote in Arabic-Indic digits (`عام <b>٢٠٢٤</b>`). The digits
   * are Arabic script, but they are not Arabic text: the element around them must not be tagged.
   */
  private ownNumber(text: Text): boolean {
    return isNumericOnly(text.data) && this.transformer.isOwnWrite(text);
  }

  /** A text node that appeared or changed outside a subtree walk. */
  private checkLooseText(text: Text): void {
    const parent = text.parentElement;
    if (!parent) return;
    const arabic = ARABIC_RE.test(text.data) && !this.ownNumber(text);

    const owner = parent.closest(OWNER_SELECTOR);
    if (owner) {
      // Typing in an editor (or an option's text changed): only make sure the editor
      // itself has the font, and Arabic's spacing once there is Arabic in it.
      if (arabic) {
        this.queue(owner);
        setAttr(owner, PLAIN_ATTR, null);
      } else if (isEditableRoot(owner)) {
        this.refreshPlain(owner);
      }
      return;
    }

    if (!arabic) {
      // Pages reuse elements: text that was Arabic may now be something else, and the
      // element must not keep Arabic spacing and alignment. Our own rewrites (Arabic-Indic
      // digits turned Western) are not such a change.
      if (
        parent.hasAttribute(ATTR) &&
        !this.transformer.isOwnWrite(text) &&
        !fontOnly(parent) &&
        !hasOwnArabicText(parent)
      ) {
        this.untag(parent);
      }
      // A bare number among Arabic text follows the numeral setting.
      this.transformer.applyToNumber(text);
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
    this.releaseDirection(el);
  }

  /**
   * Takes back the direction fixes made on behalf of `el`, and any on `el` itself.
   * Other Arabic text laid out by the same blocks then decides again for itself, so
   * a block stays right-to-left only while it is still mainly Arabic.
   */
  private releaseDirection(el: Element): void {
    const marked = [this.dirTargets.get(el), this.dirExtras.get(el), el];
    this.dirTargets.delete(el);
    this.dirExtras.delete(el);
    // The others laid out by a block that loses its mark are planned again, and so must
    // not count as fixed any more: the fix recorded for them was that very mark.
    const detach = (other: Element, target: Element) => {
      if (this.dirTargets.get(other) === target) this.dirTargets.delete(other);
      if (this.dirExtras.get(other) === target) this.dirExtras.delete(other);
      this.redirect.add(other);
    };
    for (const target of marked) {
      if (!target?.hasAttribute(DIR_ATTR)) continue;
      target.removeAttribute(DIR_ATTR);
      if (target !== el && target.hasAttribute(ATTR)) detach(target, target);
      for (const other of target.querySelectorAll(`[${ATTR}]`)) {
        if (other !== el) detach(other, target);
      }
    }
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
      // Walking only queues elements: half of the slice is kept for tagging them.
      this.walkSlice(Math.min(deadline, performance.now() + SLICE_MS / 2));
      this.tagBatch(deadline);
      this.replanDirection();
    } while (this.hasWork() && performance.now() < deadline);
    this.styles.flush();
    if (this.hasWork()) this.schedule();
  }

  private hasWork(): boolean {
    return (
      this.walker !== null ||
      this.roots.length > 0 ||
      this.pending.length > 0 ||
      this.lists.size > 0 ||
      this.redirect.size > 0
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
        if (fontOnly(el)) continue;
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
          const owner = el.closest(OWNER_SELECTOR);
          if (owner) {
            this.queue(owner);
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
          if (ARABIC_RE.test((node as Text).data) && !this.ownNumber(node as Text)) {
            const parent = node.parentElement;
            if (parent) {
              if (parent.hasAttribute(ATTR)) {
                this.transformer.applyToText(node as Text, parent);
                // Tagged already, so it was moved here (or put back): its block is a new one.
                if (this.options.fixDirection && !this.dirTargets.has(parent)) this.redirect.add(parent);
              } else {
                this.pending.push(parent);
              }
            }
          } else {
            this.transformer.applyToNumber(node as Text);
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
    // `load` events of stylesheets inside a shadow tree do not reach the document.
    root.addEventListener('load', this.onStylesheetLoad, true);
    this.roots.push(root);
  }

  /**
   * A number that moves whenever the page's set of stylesheets changes: one added,
   * removed, or swapped for another. Comparing the whole set means walking every
   * shadow root, so between re-checks (`thorough`) only the document's count is watched.
   */
  private stylesheetStamp(thorough: boolean): number {
    const count = document.styleSheets.length + (document.adoptedStyleSheets?.length ?? 0);
    if (thorough || count !== this.sheetCount) {
      this.sheetCount = count;
      const sheets: CSSStyleSheet[] = [];
      for (const scope of this.scopes()) {
        for (const sheet of [...scope.styleSheets, ...(scope.adoptedStyleSheets ?? [])]) {
          if (!this.styles.owns(sheet)) sheets.push(sheet);
        }
      }
      const same =
        sheets.length === this.sheets.length && sheets.every((sheet, i) => sheet === this.sheets[i]);
      if (!same) {
        this.sheets = sheets;
        this.sheetGeneration++;
      }
    }
    return this.sheetGeneration;
  }

  /** Reads everything needed to tag `el`. Makes no changes. */
  private planFor(el: Element, ignoreMarks: boolean, lists?: Map<Element, boolean>): TagPlan | null {
    const cs = getComputedStyle(el);
    const stack = stripOwnFamily(cs.fontFamily);
    if (!stack) return null;
    const textField = isTextField(el);
    const bare = fontOnly(el);
    const prose = !bare && isProse(el);
    return {
      el,
      stack,
      heading: !bare && el.closest('h1,h2,h3,h4,h5,h6') !== null,
      prose: prose ? lineHeightBucket(cs.lineHeight, cs.fontSize) : null,
      justifiable:
        prose && cs.display !== 'inline' && cs.display !== 'contents' && JUSTIFIABLE.has(cs.textAlign),
      direction: this.options.fixDirection && !bare ? planDirection(el, cs, ignoreMarks, lists) : null,
      // A field follows what is typed in it unless the site made it right-to-left —
      // not when it merely sits in a block that Khatt itself flipped.
      autoDir:
        this.options.fixDirection &&
        textField &&
        !el.hasAttribute('dir') &&
        (cs.direction !== 'rtl' || (!ignoreMarks && el.closest(FLIPPED_SELECTOR) !== null)),
      plain: (isFontField(el) || isEditableRoot(el)) && !holdsArabic(el),
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
    setAttr(el, PLAIN_ATTR, plan.plain ? '' : null);

    if (plan.direction) this.applyDirection(el, plan.direction, replace);
    if (plan.autoDir) {
      el.setAttribute('dir', 'auto');
      el.setAttribute(AUTO_DIR_ATTR, '');
    } else if (replace && el.hasAttribute(AUTO_DIR_ATTR)) {
      el.removeAttribute('dir');
      el.removeAttribute(AUTO_DIR_ATTR);
    }
    this.sheetStamp.set(el, stamp);
  }

  private applyDirection(el: Element, fix: DirectionFix, replace: boolean): void {
    const { target, value, also } = fix;
    if (replace || !target.hasAttribute(DIR_ATTR)) setAttr(target, DIR_ATTR, value);
    this.dirTargets.set(el, target);
    if (also) {
      setAttr(also, DIR_ATTR, 'rtl-bidi');
      this.dirExtras.set(el, also);
    }
  }

  /** Works out the direction fix again for tagged elements whose block lost its mark or changed. */
  private replanDirection(): void {
    if (this.redirect.size === 0) return;
    const els = [...this.redirect].filter(
      (el) => el.isConnected && el.hasAttribute(ATTR) && !fontOnly(el) && !this.dirTargets.has(el),
    );
    this.redirect.clear();
    if (!this.options.fixDirection) return;
    const lists = new Map<Element, boolean>();
    const fixes = els.map((el) => planDirection(el, getComputedStyle(el), false, lists));
    els.forEach((el, i) => {
      const fix = fixes[i];
      if (fix) this.applyDirection(el, fix, false);
    });
  }

  /** Reads all computed styles first, then writes all attributes, to avoid layout thrash. */
  private tagBatch(deadline: number): void {
    if (this.pending.length === 0) return;
    const stamp = this.stylesheetStamp(false);

    const plans: TagPlan[] = [];
    // Nothing is written until every plan is made, so a list's verdict holds for the batch.
    const lists = new Map<Element, boolean>();
    const limit = Math.min(this.pending.length, TAG_BATCH_MAX);
    let taken = 0;
    while (taken < limit) {
      const el = this.pending[taken++]!;
      if (el.isConnected && !el.hasAttribute(ATTR)) {
        const plan = this.planFor(el, false, lists);
        if (plan) plans.push(plan);
      }
      if (taken >= TAG_BATCH_MIN && taken % 8 === 0 && performance.now() >= deadline) break;
    }
    this.pending.splice(0, taken);
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
    const stamp = this.stylesheetStamp(true);
    const stale = this.tagged().filter((el) => this.sheetStamp.get(el) !== stamp);
    if (stale.length) this.revalidateChunk(stale, 0, stamp);
  }

  private revalidateChunk(stale: Element[], from: number, stamp: number): void {
    if (!this.running) return;
    const chunk = stale
      .slice(from, from + REVALIDATE_CHUNK)
      .filter((el) => el.isConnected && el.hasAttribute(ATTR));

    // A dir="auto" Khatt put on a text field hides the direction the site gives it, so
    // it comes off for the measurement; the fresh plan puts it back where it still belongs.
    const fields = chunk.filter((el) => el.hasAttribute(AUTO_DIR_ATTR));
    for (const el of fields) el.removeAttribute('dir');

    // Off and back on within one task: nothing is painted in between.
    let plans: (TagPlan | null)[];
    this.styles.setDisabled(true);
    try {
      const lists = new Map<Element, boolean>();
      plans = chunk.map((el) => this.planFor(el, true, lists));
    } finally {
      this.styles.setDisabled(false);
    }
    chunk.forEach((el, i) => {
      if (!plans[i] && el.hasAttribute(AUTO_DIR_ATTR)) el.setAttribute('dir', 'auto');
    });

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
