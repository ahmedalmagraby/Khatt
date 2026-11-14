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
import { isTextField, planDirection, type DirectionFix } from './direction';
import type { StyleManager } from './styles';
import { TextTransformer } from './transforms';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'PRE', 'CODE', 'KBD', 'SAMP']);
const SKIP_SELECTOR = 'script,style,noscript,template,pre,code,kbd,samp,[data-khatt-ignore]';
/**
 * Rich-text editors. Their content belongs to the user (and to the editor's own
 * model), so nothing inside is tagged or rewritten — only the editor element itself
 * gets the font, which its content inherits.
 */
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false" i])';

/** Elements whose Arabic text is running prose and may get a taller line height. */
const PROSE_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'DD', 'TD']);
/** Any element with at least this much text of its own also counts as prose. */
const PROSE_MIN_CHARS = 80;
/** Alignments that are not a deliberate choice against justification. */
const JUSTIFIABLE = new Set(['start', 'left', 'right', 'end', 'justify']);

/** Main-thread time per slice, and how many elements are tagged per read/write batch. */
const SLICE_MS = 6;
const TAG_BATCH = 250;

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
  return SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-khatt-ignore');
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
  if (PROSE_TAGS.has(el.tagName)) return true;
  let chars = 0;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) chars += (child as Text).length;
    if (chars >= PROSE_MIN_CHARS) return true;
  }
  return false;
}

/**
 * Finds elements that directly contain Arabic text (and text fields and editors,
 * where Arabic may be typed) and tags them: font stack, prose line height,
 * direction fix. Work is sliced so the page stays responsive, and a
 * MutationObserver keeps up with dynamically added content.
 */
export class Scanner {
  private roots: Node[] = [];
  private walker: TreeWalker | null = null;
  private pending: Element[] = [];
  private shadowRoots = new Set<ShadowRoot>();
  private scheduled = false;
  private running = false;
  private options: ScannerOptions = { fixDirection: true, hideTashkeel: false, numerals: 'off' };
  private transformer = new TextTransformer();
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
    if (document.documentElement) this.roots.push(document.documentElement);
    this.schedule();
  }

  /** Stops scanning and removes every tag, restoring the page's own fonts, direction and text. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.observer.disconnect();
    this.roots = [];
    this.walker = null;
    this.pending = [];
    const selector = `[${ATTR}],[${PROSE_ATTR}],[${DIR_ATTR}],[${AUTO_DIR_ATTR}],[${JUSTIFY_ATTR}]`;
    for (const scope of [document, ...this.shadowRoots]) {
      for (const el of scope.querySelectorAll(selector)) {
        if (el.hasAttribute(AUTO_DIR_ATTR)) {
          el.removeAttribute('dir');
          el.removeAttribute(AUTO_DIR_ATTR);
        }
        if (el.hasAttribute(ATTR)) this.transformer.restoreIn(el);
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
    if (this.hasWork()) this.schedule();
  }

  /** Our tag changed. If something else removed it from an element that still needs it, tag again. */
  private recheck(el: Element): void {
    if (el.hasAttribute(ATTR) || !el.isConnected) return;
    if (isEditableRoot(el)) {
      this.pending.push(el);
      return;
    }
    if (el.closest(SKIP_SELECTOR) || el.closest(EDITABLE_SELECTOR)) return;
    if (isTextField(el) || hasOwnArabicText(el)) this.pending.push(el);
  }

  /** A text node that appeared or changed outside a subtree walk. */
  private checkLooseText(text: Text): void {
    if (!ARABIC_RE.test(text.data)) return;
    const parent = text.parentElement;
    if (!parent) return;
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
      return;
    }
    const deadline = performance.now() + SLICE_MS;
    do {
      this.walkSlice(deadline);
      this.tagBatch();
    } while (this.hasWork() && performance.now() < deadline);
    this.styles.flush();
    if (this.hasWork()) this.schedule();
  }

  private hasWork(): boolean {
    return this.walker !== null || this.roots.length > 0 || this.pending.length > 0;
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
    // Text fields are tagged even when empty, so Arabic typed later gets the font.
    if (isTextField(el)) this.queue(el);
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

  /** Reads all computed styles first, then writes all attributes, to avoid layout thrash. */
  private tagBatch(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, TAG_BATCH);

    const plans: TagPlan[] = [];
    for (const el of batch) {
      if (!el.isConnected || el.hasAttribute(ATTR)) continue;
      const cs = getComputedStyle(el);
      const stack = stripOwnFamily(cs.fontFamily);
      if (!stack) continue;
      const textField = isTextField(el);
      // Fields and editors get the font only: no layout, direction-by-CSS or text changes.
      const fontOnly = textField || isEditableRoot(el);
      const prose = !fontOnly && isProse(el);
      plans.push({
        el,
        stack,
        heading: !fontOnly && el.closest('h1,h2,h3,h4,h5,h6') !== null,
        prose: prose ? lineHeightBucket(cs.lineHeight, cs.fontSize) : null,
        justifiable:
          prose &&
          cs.display !== 'inline' &&
          cs.display !== 'contents' &&
          JUSTIFIABLE.has(cs.textAlign),
        direction: this.options.fixDirection && !fontOnly ? planDirection(el, cs) : null,
        autoDir:
          this.options.fixDirection &&
          textField &&
          !el.hasAttribute('dir') &&
          cs.direction !== 'rtl',
      });
    }

    for (const plan of plans) {
      plan.el.setAttribute(ATTR, this.styles.stackId(plan.stack, plan.heading));
      if (plan.prose !== null) plan.el.setAttribute(PROSE_ATTR, String(plan.prose));
      if (plan.justifiable) plan.el.setAttribute(JUSTIFY_ATTR, '');
      if (plan.direction && !plan.direction.target.hasAttribute(DIR_ATTR)) {
        plan.direction.target.setAttribute(DIR_ATTR, plan.direction.value);
      }
      if (plan.autoDir) {
        plan.el.setAttribute('dir', 'auto');
        plan.el.setAttribute(AUTO_DIR_ATTR, '');
      }
      this.transformer.applyTo(plan.el);
    }
  }
}
