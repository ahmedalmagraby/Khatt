/** Content script → background: "send me the bytes of this bundled font". */
export const FONT_MESSAGE = 'khatt:font';
/** Background → tab: "is a live Khatt content script here?" */
export const PING_MESSAGE = 'khatt:ping';
/** Popup → background: "make sure this tab has a live Khatt content script". */
export const ENSURE_MESSAGE = 'khatt:ensure';
/**
 * Popup → background: "save these slider values". Sent as the popup closes, when the
 * popup itself is gone before a write of its own (a read, then a write) could finish.
 * `host` null = the global settings.
 */
export const SAVE_MESSAGE = 'khatt:save';
/**
 * DOM event a starting content script fires on the document. Any earlier Khatt
 * instance on the page (left behind by an extension update or reload) shuts down
 * and undoes its changes, so two instances never style the same page.
 */
export const TAKEOVER_EVENT = 'khatt:takeover';

export type EnsureStatus = 'alive' | 'injected' | 'failed';
