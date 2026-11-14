import {
  DEFAULT_SETTINGS,
  GLOBAL_KEY,
  isEmptySite,
  SETTINGS_VERSION,
  VERSION_KEY,
  type Settings,
  type SiteConfig,
} from './settings';

export const BACKUP_APP = 'khatt';

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  /** Synced storage as stored: `global`, and one `site:<hostname>` entry per site. */
  data: Record<string, unknown>;
}

const SITE_KEY_RE = /^site:[\w.\-:[\]]{0,253}$/;

export function buildBackup(data: Record<string, unknown>, now: Date = new Date()): Backup {
  return {
    app: BACKUP_APP,
    version: SETTINGS_VERSION,
    exportedAt: now.toISOString(),
    data: sanitizeData(data),
  };
}

/** Parses an exported file. Throws when it is not a Khatt backup; unknown content is dropped. */
export function parseBackup(json: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('not-json');
  }
  if (!isRecord(parsed) || parsed.app !== BACKUP_APP || !isRecord(parsed.data)) {
    throw new Error('not-backup');
  }
  return sanitizeData(parsed.data);
}

/** Keeps only known keys with values of the expected type, so storage never holds junk. */
export function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { [VERSION_KEY]: SETTINGS_VERSION };
  const global = sanitizeSettings(data[GLOBAL_KEY]);
  if (Object.keys(global).length) out[GLOBAL_KEY] = global;

  for (const [key, value] of Object.entries(data)) {
    if (!SITE_KEY_RE.test(key) || !isRecord(value)) continue;
    const site: SiteConfig = {};
    if (value.enabled === false) site.enabled = false;
    const overrides = sanitizeSettings(value.overrides);
    delete overrides.enabled;
    if (Object.keys(overrides).length) site.overrides = overrides;
    if (!isEmptySite(site)) out[key] = site;
  }
  return out;
}

function sanitizeSettings(value: unknown): Partial<Settings> {
  const out: Record<string, unknown> = {};
  if (!isRecord(value)) return out;
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const v = value[key];
    if (typeof v === typeof fallback && (typeof v !== 'number' || Number.isFinite(v))) out[key] = v;
  }
  return out as Partial<Settings>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
