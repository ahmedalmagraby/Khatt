import { FAMILY, STYLE_ID, stackRule } from '@/lib/css';

/**
 * A page that removes Khatt's <style> gets it back. One that removes it again at once,
 * over and over, is given it back less and less often instead of every frame.
 */
const REATTACH_WINDOW_MS = 1000;
const REATTACH_LIMIT = 15;
const REATTACH_BACKOFF_MIN_MS = 2000;
const REATTACH_BACKOFF_MAX_MS = 60000;

/**
 * Owns Khatt's CSS: the @font-face block, the typography/direction rules, and one
 * rule per original font stack. The document gets a <style> element; open shadow
 * roots share one constructed sheet without the @font-face block (which must live
 * at document level).
 */
export class StyleManager {
  private styleEl: HTMLStyleElement | null = null;
  private shadowSheet: CSSStyleSheet | null = null;
  /** Key: original stack, prefixed for headings. Value: the token written to the attribute. */
  private stacks = new Map<string, { token: string; stack: string; heading: boolean }>();
  private headingFamily = FAMILY;
  private fontCss = '';
  private baseCss = '';
  private dirty = false;
  private reattach = { since: 0, count: 0, backoff: 0, until: 0 };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  setFontCss(css: string): void {
    if (css === this.fontCss) return;
    this.fontCss = css;
    this.dirty = true;
  }

  setBaseCss(css: string): void {
    if (css === this.baseCss) return;
    this.baseCss = css;
    this.dirty = true;
  }

  /** The family used for Arabic text inside headings (the body family when no heading font is set). */
  setHeadingFamily(family: string): void {
    if (family === this.headingFamily) return;
    this.headingFamily = family;
    this.dirty = true;
  }

  /** Returns the token for an original font stack, registering it on first sight. */
  stackId(stack: string, heading = false): string {
    const key = heading ? `h|${stack}` : stack;
    let entry = this.stacks.get(key);
    if (!entry) {
      entry = { token: `${heading ? 'h' : ''}${this.stacks.size + 1}`, stack, heading };
      this.stacks.set(key, entry);
      this.dirty = true;
    }
    return entry.token;
  }

  /** False once the page has removed Khatt's stylesheet (or before it was first written). */
  get attached(): boolean {
    // While backing off, missing counts as attached: nothing is to be done about it yet.
    return this.styleEl?.isConnected === true || performance.now() < this.reattach.until;
  }

  /** True for Khatt's own stylesheets, as opposed to the page's. */
  owns(sheet: CSSStyleSheet): boolean {
    return sheet === this.shadowSheet || (this.styleEl !== null && sheet.ownerNode === this.styleEl);
  }

  /**
   * Switches all of Khatt's rules off or on, in the document and in shadow roots.
   * Used to read what the page's own styles say about an element.
   */
  setDisabled(disabled: boolean): void {
    if (this.styleEl) this.styleEl.disabled = disabled;
    if (this.shadowSheet) this.shadowSheet.disabled = disabled;
  }

  flush(): void {
    // Nowhere to put the stylesheet yet: stay dirty so the next flush writes it.
    if (!document.documentElement) return;
    if (!this.styleEl?.isConnected && performance.now() < this.reattach.until) return;
    const attached = this.ensureAttached();
    if (!this.dirty && attached) return;
    const shared = this.sharedCss();
    if (this.styleEl) this.styleEl.textContent = `${this.fontCss}\n${shared}`;
    try {
      this.shadowSheet?.replaceSync(shared);
    } catch {
      // Constructed sheets unavailable — shadow roots simply keep their own fonts.
    }
    this.dirty = false;
  }

  adoptInto(root: ShadowRoot): void {
    try {
      if (!this.shadowSheet) {
        this.shadowSheet = new CSSStyleSheet();
        this.shadowSheet.replaceSync(this.sharedCss());
      }
      if (!root.adoptedStyleSheets.includes(this.shadowSheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.shadowSheet];
      }
    } catch {
      // See flush().
    }
  }

  releaseFrom(root: ShadowRoot): void {
    try {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== this.shadowSheet);
    } catch {
      // Ignore.
    }
  }

  destroy(): void {
    this.styleEl?.remove();
    this.styleEl = null;
    // Shadow roots let go while their hosts were off the page may still hold the sheet.
    try {
      this.shadowSheet?.replaceSync('');
    } catch {
      // Ignore.
    }
    this.shadowSheet = null;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.reattach = { since: 0, count: 0, backoff: 0, until: 0 };
    this.stacks.clear();
    this.fontCss = '';
    this.baseCss = '';
    this.headingFamily = FAMILY;
    this.dirty = false;
  }

  private sharedCss(): string {
    const rules: string[] = [this.baseCss];
    for (const { token, stack, heading } of this.stacks.values()) {
      rules.push(stackRule(token, stack, heading ? this.headingFamily : FAMILY));
    }
    return rules.join('\n');
  }

  /** Returns false when the <style> had to be (re)created and therefore needs its content written. */
  private ensureAttached(): boolean {
    if (this.styleEl?.isConnected) return true;
    if (this.styleEl && this.removedTooOften()) return true;
    this.styleEl ??= Object.assign(document.createElement('style'), { id: STYLE_ID });
    document.documentElement.append(this.styleEl);
    return false;
  }

  /** Counts one removal by the page; true when re-adding has to wait (see REATTACH_LIMIT). */
  private removedTooOften(): boolean {
    const now = performance.now();
    const r = this.reattach;
    if (now - r.since > REATTACH_WINDOW_MS) {
      r.since = now;
      r.count = 0;
    }
    if (++r.count <= REATTACH_LIMIT) return false;
    r.backoff = Math.min(Math.max(r.backoff * 2, REATTACH_BACKOFF_MIN_MS), REATTACH_BACKOFF_MAX_MS);
    r.until = now + r.backoff;
    r.since = r.until;
    r.count = 0;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.dirty = true;
      this.flush();
    }, r.backoff);
    return true;
  }
}
