import { defineContentScript } from 'wxt/utils/define-content-script';
import { SHADOW_EVENT } from '@/lib/css';

/**
 * Runs in the page's own JavaScript world. A shadow root attached to an element
 * that is already on the page produces no DOM mutation, so the main content script
 * cannot see it. This announces such attachments with an event on the host.
 * It reads nothing from the page and changes no behaviour of attachShadow.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  matchOriginAsFallback: true,
  world: 'MAIN',

  main() {
    const MARK = Symbol.for('khatt.attachShadow');
    const original = Element.prototype.attachShadow as typeof Element.prototype.attachShadow & {
      [MARK]?: true;
    };
    if (original[MARK]) return;
    const patched = function attachShadow(this: Element, init: ShadowRootInit) {
      const root = original.call(this, init);
      // Closed roots are private to the page and stay untouched.
      if (init?.mode === 'open' && this.isConnected) {
        queueMicrotask(() => {
          try {
            this.dispatchEvent(new CustomEvent(SHADOW_EVENT, { bubbles: true, composed: true }));
          } catch {
            // Never let this affect the page.
          }
        });
      }
      return root;
    };
    Object.defineProperty(patched, MARK, { value: true });
    Element.prototype.attachShadow = patched;
  },
});
