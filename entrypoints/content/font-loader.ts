import { browser } from 'wxt/browser';
import { ARABIC_UNICODE_RANGE } from '@/lib/arabic';
import { FAMILY, HEADING_FAMILY, type FaceSpec } from '@/lib/css';
import { FONT_MESSAGE } from '@/lib/messages';

const OWN_FAMILIES = new Set([FAMILY, HEADING_FAMILY]);
const unquote = (family: string) => family.replace(/^["']|["']$/g, '');

/**
 * Normally fonts load through `@font-face { src: url(chrome-extension://…) }`.
 * On some sites that request is aborted (for example by the site's service worker),
 * and the text would silently keep the site's font. This watches for that failure
 * and can instead register the fonts from their bytes, which no page policy or
 * service worker can interfere with.
 */
export class FontLoader {
  private faces = new Map<string, FontFace>();
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private generation = 0;
  private onFailure: (() => void) | null = null;

  private handleError = (event: Event) => {
    const failed = (event as FontFaceSetLoadEvent).fontfaces ?? [];
    // Faces registered from bytes cannot fail to download; only url() faces land here.
    // A face no longer in the document was simply withdrawn mid-download (the font was
    // changed, or Khatt restarted) — that is not the page blocking it.
    const blocked = (face: FontFace) =>
      OWN_FAMILIES.has(unquote(face.family)) && !this.isOurs(face) && document.fonts.has(face);
    if (failed.some(blocked)) {
      this.onFailure?.();
    }
  };

  /** Calls `onFailure` when a Khatt url() font fails to download on this page. */
  watch(onFailure: () => void): void {
    this.onFailure = onFailure;
    document.fonts.addEventListener('loadingerror', this.handleError);
  }

  unwatch(): void {
    this.onFailure = null;
    document.fonts.removeEventListener('loadingerror', this.handleError);
  }

  /** Registers exactly these faces from their bytes, replacing any registered before. */
  async use(specs: FaceSpec[]): Promise<void> {
    const generation = ++this.generation;
    const wanted = new Map(specs.map((spec) => [JSON.stringify(spec), spec]));

    for (const [key, face] of this.faces) {
      if (wanted.has(key)) continue;
      document.fonts.delete(face);
      this.faces.delete(key);
    }

    await Promise.all(
      [...wanted].map(async ([key, spec]) => {
        if (this.faces.has(key)) return;
        try {
          const face = new FontFace(spec.family, await this.load(spec.file), {
            weight: spec.weight,
            style: 'normal',
            display: 'swap',
            unicodeRange: ARABIC_UNICODE_RANGE,
            sizeAdjust: `${spec.sizeAdjust}%`,
          } as FontFaceDescriptors);
          // Settings changed while the bytes were loading — this face is no longer wanted.
          if (generation !== this.generation) return;
          document.fonts.add(face);
          this.faces.set(key, face);
        } catch (err) {
          console.warn('[Khatt] could not load font', spec.file, err);
        }
      }),
    );
  }

  clear(): void {
    this.generation++;
    for (const face of this.faces.values()) document.fonts.delete(face);
    this.faces.clear();
  }

  private isOurs(face: FontFace): boolean {
    for (const ours of this.faces.values()) if (ours === face) return true;
    return false;
  }

  private load(file: string): Promise<ArrayBuffer> {
    let pending = this.bytes.get(file);
    if (!pending) {
      pending = this.fetchBytes(file);
      // Don't cache a failure; a later attempt may work.
      pending.catch(() => this.bytes.delete(file));
      this.bytes.set(file, pending);
    }
    return pending;
  }

  /** Reads the font directly; if the page blocks that too, asks the background worker for it. */
  private async fetchBytes(file: string): Promise<ArrayBuffer> {
    try {
      const response = await fetch(browser.runtime.getURL(`/fonts/${file}` as never));
      if (response.ok) return await response.arrayBuffer();
    } catch {
      // Fall through to the background worker.
    }
    const reply = (await browser.runtime.sendMessage({ type: FONT_MESSAGE, file })) as
      | { base64?: string }
      | undefined;
    if (!reply?.base64) throw new Error(`font unavailable: ${file}`);
    const binary = atob(reply.base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
  }
}
