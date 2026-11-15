import { chromium, type BrowserContext, type Worker } from '@playwright/test';

export type { Worker };
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(here, '..', '..', '.output', 'chrome-mv3');
const STRICT_CSP = "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'";

// Evaluated inside the extension's service worker, where `chrome` exists.
declare const chrome: {
  storage: {
    sync: {
      get(key?: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
      clear(): Promise<void>;
    };
    local: {
      get(key?: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
};

export interface Harness {
  /** Origin of the fixture server: /basic, /typo, /extras, /hard, /design, /big?n=&lang= and /csp (strict CSP). */
  base: string;
  context: BrowserContext;
  extensionId: string;
  setStorage(items: Record<string, unknown>): Promise<void>;
  removeStorage(key: string): Promise<void>;
  getStorage(): Promise<Record<string, unknown>>;
  clearStorage(): Promise<void>;
  /** The extension's background service worker. */
  worker(): Promise<Worker>;
  /** Device-local storage. An empty-string value removes the key. */
  setLocal(items: Record<string, string>): Promise<void>;
  getLocal(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

const AR_SENTENCE = 'هذه فقرة عربية للاختبار تحتوي على <b>نص عريض</b> و<a href="#">رابط</a> وبعض الكلمات الإضافية.';
const EN_SENTENCE = 'This is an English paragraph with <b>bold text</b> and <a href="#">a link</a> and more words.';

/** A long article-like page: `n` paragraphs in nested sections. */
function bigPage(n: number, lang: string): string {
  const sentence = lang === 'ar' ? AR_SENTENCE : EN_SENTENCE;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 50 === 0) parts.push(`${i ? '</section>' : ''}<section><h2>${lang === 'ar' ? 'عنوان' : 'Heading'} ${i}</h2>`);
    parts.push(`<p>${sentence} ${i}</p>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>big</title><style>body{font:16px Georgia,serif;max-width:700px}</style></head><body>${parts.join('')}</section></body></html>`;
}

/** Like some real sites' workers: handles every request itself and fails the ones it cannot fetch. */
const BLOCKING_WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.url.startsWith('chrome-extension://')) e.respondWith(Promise.reject(new Error('blocked')));
});
`;

const SW_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px Georgia,serif}</style></head><body><p id="arabic">صفحة يتحكم بها عامل خدمة يرفض طلبات الإضافات.</p><h2 id="heading">عنوان</h2></body></html>';

const SLOW_CSS =
  '.late{font-family:Verdana,sans-serif;line-height:2.6}.center{text-align:center}.rtl{direction:rtl}';

/** The stylesheet link sits after the content, so the content is shown (and tagged) before it loads. */
const LATE_CSS_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{width:500px}</style></head><body>' +
  '<p id="late" class="late">فقرة عربية تصل ورقة أنماطها متأخرة بعد أن عرضت الصفحة ووسمت عناصرها.</p>' +
  '<p id="late-center" class="center">فقرة في الوسط.</p>' +
  '<p id="late-rtl" class="rtl">فقرة يجعلها الموقع من اليمين.</p>' +
  '<input id="late-field" class="rtl" type="text"><input id="late-plain-field" type="text">' +
  '<link rel="stylesheet" href="/slow.css"></body></html>';

const DESIGN_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><script>document.designMode = "on";</script></head><body><p id="p">نص عربي في مستند قابل للتحرير</p></body></html>';

/** Starts the fixture server and a Chromium with the built extension loaded. */
export async function launch(): Promise<Harness> {
  const server: Server = createServer((req, res) => {
    const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/big') {
      res.writeHead(200, headers);
      res.end(bigPage(Number(url.searchParams.get('n')) || 1000, url.searchParams.get('lang') ?? 'ar'));
      return;
    }
    if (url.pathname === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(BLOCKING_WORKER);
      return;
    }
    if (url.pathname === '/sw-page') {
      res.writeHead(200, headers);
      res.end(SW_PAGE);
      return;
    }
    if (url.pathname === '/slow.css') {
      // Arrives well after the page's content has been shown and tagged.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(SLOW_CSS);
      }, 700);
      return;
    }
    if (url.pathname === '/late-css') {
      res.writeHead(200, headers);
      res.end(LATE_CSS_PAGE);
      return;
    }
    if (url.pathname === '/design') {
      res.writeHead(200, headers);
      res.end(DESIGN_PAGE);
      return;
    }
    const pages: Record<string, string> = {
      '/csp': 'csp.html',
      '/typo': 'typo.html',
      '/extras': 'extras.html',
      '/hard': 'hard.html',
      '/review': 'review.html',
      '/review2': 'review2.html',
      '/dirauto': 'dirauto.html',
    };
    const name = pages[url.pathname] ?? 'basic.html';
    if (name === 'csp.html') headers['Content-Security-Policy'] = STRICT_CSP;
    res.writeHead(200, headers);
    res.end(readFileSync(join(here, 'fixtures', name)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = async (): Promise<Worker> =>
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL((await worker()).url()).host;

  return {
    base,
    context,
    extensionId,
    setStorage: async (items) => (await worker()).evaluate((i) => chrome.storage.sync.set(i), items),
    removeStorage: async (key) => (await worker()).evaluate((k) => chrome.storage.sync.remove(k), key),
    getStorage: async () => (await worker()).evaluate(() => chrome.storage.sync.get()),
    clearStorage: async () => (await worker()).evaluate(() => chrome.storage.sync.clear()),
    setLocal: async (items) =>
      (await worker()).evaluate(async (i) => {
        for (const [key, value] of Object.entries(i)) {
          if (value) await chrome.storage.local.set({ [key]: value });
          else await chrome.storage.local.remove(key);
        }
      }, items),
    worker,
    getLocal: async () => (await worker()).evaluate(() => chrome.storage.local.get()),
    close: async () => {
      await context.close();
      server.close();
    },
  };
}
