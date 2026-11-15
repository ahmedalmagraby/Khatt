import { browser } from 'wxt/browser';
import {
  GLOBAL_KEY,
  isEmptySite,
  resolveSettings,
  siteKey,
  withoutSiteOverrides,
  withSiteEnabled,
  withSiteOverrides,
  type Settings,
  type SiteConfig,
} from './settings';

/** storage.local: the name of the installed font to use — it only makes sense on this device. */
export const SYSTEM_FONT_KEY = 'systemFont';
const SITE_PREFIX = 'site:';

export interface RawSettings {
  global: Partial<Settings>;
  site: SiteConfig;
}

/** Stored (unmerged) settings. `hostname` null = pages without a site, global only. */
export async function loadRaw(hostname: string | null): Promise<RawSettings> {
  const keys = hostname === null ? [GLOBAL_KEY] : [GLOBAL_KEY, siteKey(hostname)];
  const data = await browser.storage.sync.get(keys);
  return {
    global: (data[GLOBAL_KEY] as Partial<Settings> | undefined) ?? {},
    site: (hostname !== null && (data[siteKey(hostname)] as SiteConfig | undefined)) || {},
  };
}

export async function loadSettings(hostname: string | null): Promise<Settings> {
  const raw = await loadRaw(hostname);
  return resolveSettings(raw.global, raw.site);
}

export async function loadSystemFont(): Promise<string> {
  const data = await browser.storage.local.get(SYSTEM_FONT_KEY);
  const name = data[SYSTEM_FONT_KEY];
  return typeof name === 'string' ? name : '';
}

export async function setSystemFont(name: string): Promise<void> {
  const clean = name.trim();
  if (clean) await browser.storage.local.set({ [SYSTEM_FONT_KEY]: clean });
  else await browser.storage.local.remove(SYSTEM_FONT_KEY);
}

/**
 * Every change below reads the stored value, alters it and writes it back. They run
 * one at a time, so two changes made together (a switch toggled while a slider is
 * still being saved) cannot both start from the same value and undo each other.
 */
let writes: Promise<unknown> = Promise.resolve();
function inTurn(write: () => Promise<void>): Promise<void> {
  const next = writes.then(write, write);
  writes = next.catch(() => {});
  return next;
}

export function updateGlobal(patch: Partial<Settings>): Promise<void> {
  return inTurn(async () => {
    const { global } = await loadRaw(null);
    await browser.storage.sync.set({ [GLOBAL_KEY]: { ...global, ...patch } });
  });
}

async function saveSite(hostname: string, site: SiteConfig): Promise<void> {
  if (isEmptySite(site)) await browser.storage.sync.remove(siteKey(hostname));
  else await browser.storage.sync.set({ [siteKey(hostname)]: site });
}

export function setSiteEnabled(hostname: string, enabled: boolean): Promise<void> {
  return inTurn(async () => {
    const { site } = await loadRaw(hostname);
    await saveSite(hostname, withSiteEnabled(site, enabled));
  });
}

export function updateSiteOverrides(hostname: string, patch: Partial<Settings>): Promise<void> {
  return inTurn(async () => {
    const { site } = await loadRaw(hostname);
    await saveSite(hostname, withSiteOverrides(site, patch));
  });
}

export function clearSiteOverrides(hostname: string): Promise<void> {
  return inTurn(async () => {
    const { site } = await loadRaw(hostname);
    await saveSite(hostname, withoutSiteOverrides(site));
  });
}

/** Drops individual overrides of a site, leaving its other settings as they are. */
export function removeSiteOverrideKeys(hostname: string, keys: (keyof Settings)[]): Promise<void> {
  return inTurn(async () => {
    const { site } = await loadRaw(hostname);
    const overrides = { ...site.overrides };
    for (const key of keys) delete overrides[key];
    await saveSite(hostname, { ...site, overrides });
  });
}

/** Forgets everything stored for a site, returning it to the global settings. */
export function removeSite(hostname: string): Promise<void> {
  return inTurn(() => browser.storage.sync.remove(siteKey(hostname)));
}

/** Every site that has something stored, sorted by hostname. */
export async function loadSites(): Promise<{ hostname: string; config: SiteConfig }[]> {
  const data = await browser.storage.sync.get(null);
  return Object.entries(data)
    .filter(([key]) => key.startsWith(SITE_PREFIX))
    .map(([key, config]) => ({
      hostname: key.slice(SITE_PREFIX.length),
      config: (config ?? {}) as SiteConfig,
    }))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
}

/** Everything in synced storage, for export. */
export async function loadEverything(): Promise<Record<string, unknown>> {
  return browser.storage.sync.get(null);
}

/** Replaces all synced settings (import). */
export async function replaceEverything(data: Record<string, unknown>): Promise<void> {
  await browser.storage.sync.clear();
  await browser.storage.sync.set(data);
}

/**
 * Calls `onChange` whenever something that affects this site changes in storage.
 * `hostname` null = global only; '*' = every site as well (the options page).
 */
export function watchStorage(hostname: string | null, onChange: () => void): () => void {
  const key = hostname === null || hostname === '*' ? null : siteKey(hostname);
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local') {
      if (SYSTEM_FONT_KEY in changes) onChange();
      return;
    }
    if (area !== 'sync') return;
    const relevant =
      GLOBAL_KEY in changes ||
      (key !== null && key in changes) ||
      (hostname === '*' && Object.keys(changes).some((k) => k.startsWith(SITE_PREFIX)));
    if (relevant) onChange();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
