import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { BUNDLED_FONTS } from '@/lib/fonts';
import { ENSURE_MESSAGE, FONT_MESSAGE, PING_MESSAGE, type EnsureStatus } from '@/lib/messages';
import { SETTINGS_VERSION, VERSION_KEY } from '@/lib/settings';

const FONT_FILES = new Set(BUNDLED_FONTS.flatMap((font) => font.faces.map((face) => face.file)));

async function fontAsBase64(file: string): Promise<string> {
  const response = await fetch(browser.runtime.getURL(`/fonts/${file}` as never));
  if (!response.ok) throw new Error(`font not found: ${file}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Runs the extension's content scripts in a tab that is already open. Chrome only
 * injects them when a page loads, so tabs open before an install, update or reload
 * would otherwise need a manual refresh.
 */
async function injectInto(tabId: number): Promise<boolean> {
  try {
    for (const script of browser.runtime.getManifest().content_scripts ?? []) {
      if (!script.js?.length) continue;
      await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: script.js as never,
        world: (script as { world?: 'MAIN' | 'ISOLATED' }).world ?? 'ISOLATED',
        injectImmediately: true,
      });
    }
    return true;
  } catch {
    // Pages extensions may not touch (browser pages, the web store), or unloaded tabs.
    return false;
  }
}

async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? false : injectInto(tab.id))));
}

/** Injects into `tabId` unless a live content script already answers there. */
async function ensureTab(tabId: number): Promise<EnsureStatus> {
  try {
    const reply = (await browser.tabs.sendMessage(tabId, { type: PING_MESSAGE }, { frameId: 0 })) as
      | { ok?: boolean }
      | undefined;
    if (reply?.ok) return 'alive';
  } catch {
    // No listener in the tab: the script was never injected, or belongs to an older version.
  }
  return (await injectInto(tabId)) ? 'injected' : 'failed';
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    try {
      const { [VERSION_KEY]: stored } = await browser.storage.sync.get(VERSION_KEY);
      // Future schema migrations run here, keyed on `stored`.
      if (stored !== SETTINGS_VERSION) {
        await browser.storage.sync.set({ [VERSION_KEY]: SETTINGS_VERSION });
      }
    } catch (err) {
      console.error('[Khatt] settings migration failed', err);
    }
    if (details.reason === 'install' || details.reason === 'update') {
      try {
        await injectIntoOpenTabs();
      } catch (err) {
        console.error('[Khatt] could not start in open tabs', err);
      }
    }
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const request = message as { type?: unknown; file?: unknown; tabId?: unknown } | null;

    // A page where the content script cannot read a bundled font asks for its bytes here.
    if (request?.type === FONT_MESSAGE) {
      // Only bundled font files are ever served.
      if (typeof request.file !== 'string' || !FONT_FILES.has(request.file)) {
        sendResponse({});
        return;
      }
      const file = request.file;
      (async () => {
        try {
          sendResponse({ base64: await fontAsBase64(file) });
        } catch (err) {
          console.error('[Khatt] could not read font', file, err);
          sendResponse({});
        }
      })();
      return true; // keeps the channel open for the async reply
    }

    // The popup makes sure the tab it was opened on is actually running Khatt.
    if (request?.type === ENSURE_MESSAGE && typeof request.tabId === 'number') {
      const tabId = request.tabId;
      (async () => {
        try {
          sendResponse({ status: await ensureTab(tabId) });
        } catch {
          sendResponse({ status: 'failed' satisfies EnsureStatus });
        }
      })();
      return true;
    }
  });
});
