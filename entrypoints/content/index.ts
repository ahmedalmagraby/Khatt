import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  baseCss,
  FAMILY,
  fontCssFor,
  fontSpecsFor,
  HEADING_FAMILY,
  SHADOW_EVENT,
  type FaceSpec,
} from '@/lib/css';
import { PING_MESSAGE, TAKEOVER_EVENT } from '@/lib/messages';
import type { Settings } from '@/lib/settings';
import { loadSettings, loadSystemFont, watchStorage } from '@/lib/storage';
import { FontLoader } from './font-loader';
import { Scanner } from './scanner';
import { StyleManager } from './styles';

/** Frames without their own host (about:blank, srcdoc) follow the top page when reachable. */
function currentHost(): string {
  if (location.hostname) return location.hostname;
  try {
    return window.top?.location.hostname ?? '';
  } catch {
    return '';
  }
}

const fontUrl = (file: string) => browser.runtime.getURL(`/fonts/${file}` as never);

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  matchOriginAsFallback: true,

  async main(ctx) {
    // Tell any earlier instance on this page (from before an update or reload) to step aside.
    document.dispatchEvent(new Event(TAKEOVER_EVENT));

    const host = currentHost();
    const styles = new StyleManager();
    const scanner = new Scanner(styles);
    const fonts = new FontLoader();
    /** Set once this page has refused a font loaded by URL; fonts then come from their bytes. */
    let fromBytes = false;
    let stopped = false;
    /** Guards against an older read of the settings landing after a newer one. */
    let latestRefresh = 0;

    const apply = (settings: Settings, systemFont: string) => {
      if (!settings.enabled) {
        scanner.stop();
        styles.destroy();
        fonts.clear();
        return;
      }
      const size = settings.sizeAdjust;
      const choices: [string, string][] = [[settings.fontId, FAMILY]];
      if (settings.headingFontId) choices.push([settings.headingFontId, HEADING_FAMILY]);

      const css: string[] = [];
      const specs: FaceSpec[] = [];
      for (const [fontId, family] of choices) {
        // Installed fonts always load by name; bundled ones by URL, or from bytes on pages that block that.
        const bundled = fromBytes ? fontSpecsFor(fontId, systemFont, size, family) : null;
        if (bundled) specs.push(...bundled);
        else css.push(fontCssFor(fontId, systemFont, size, fontUrl, family));
      }
      styles.setFontCss(css.join('\n'));
      void fonts.use(specs);

      styles.setHeadingFamily(settings.headingFontId ? HEADING_FAMILY : FAMILY);
      styles.setBaseCss(baseCss(settings));
      styles.flush();
      scanner.setOptions({
        fixDirection: settings.fixDirection,
        hideTashkeel: settings.hideTashkeel,
        numerals: settings.numerals,
      });
      scanner.start();
    };

    const refresh = async () => {
      const mine = ++latestRefresh;
      try {
        const [settings, systemFont] = await Promise.all([loadSettings(host), loadSystemFont()]);
        if (stopped || mine !== latestRefresh) return;
        apply(settings, systemFont);
      } catch {
        // Extension context invalidated (reload/update) — nothing to do.
      }
    };

    fonts.watch(() => {
      if (fromBytes) return;
      fromBytes = true;
      void refresh();
    });

    // Sent by the page-world hook when a shadow root is attached to an element already on the page.
    const onShadow = (event: Event) => {
      const target = event.composedPath()[0] ?? event.target;
      if (target instanceof Element) scanner.noteShadowHost(target);
    };
    document.addEventListener(SHADOW_EVENT, onShadow, true);

    // A page that was frozen (background tab) or restored from the back/forward cache
    // may have missed settings changes; re-read them when it comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);

    // Lets the background check that this tab is running a live copy of the script.
    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if ((message as { type?: unknown } | null)?.type === PING_MESSAGE) sendResponse({ ok: true });
    };
    browser.runtime.onMessage.addListener(onMessage);

    let unwatch = () => {};
    const shutdown = () => {
      if (stopped) return;
      stopped = true;
      document.removeEventListener(TAKEOVER_EVENT, shutdown);
      document.removeEventListener(SHADOW_EVENT, onShadow, true);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      try {
        browser.runtime.onMessage.removeListener(onMessage);
        unwatch();
      } catch {
        // The extension context is already gone.
      }
      fonts.unwatch();
      fonts.clear();
      scanner.stop();
      styles.destroy();
    };
    // A newer instance has started on this page.
    document.addEventListener(TAKEOVER_EVENT, shutdown);
    ctx.onInvalidated(shutdown);

    await refresh();
    if (!stopped) unwatch = watchStorage(host, () => void refresh());
  },
});
