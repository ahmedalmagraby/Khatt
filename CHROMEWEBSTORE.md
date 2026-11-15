# Chrome Web Store Listing — Khatt

> Last Updated: 2026-11-14

Everything needed for the Chrome Developer Dashboard, ready to copy. Items marked **TODO** need you.

## Store Listing

**Extension Name**

Khatt — Beautiful Arabic Text

(Arabic locale: خط — نص عربي أجمل)

**Short Description** (129 of 132 characters; also the manifest description)

Makes Arabic text easier to read on any website: better fonts, line spacing and right-to-left alignment. Other text is untouched.

**Detailed Description**

```
Khatt makes Arabic text on any website easier and more pleasant to read by giving it a better font, comfortable spacing and correct right-to-left alignment — without changing anything else on the page.

FEATURES
• Better fonts — choose from eight Arabic typefaces (IBM Plex Sans Arabic, Vazirmatn, Noto Naskh, Noto Kufi, Noto Sans Arabic, Readex Pro, Tajawal, Amiri), or use any font installed on your computer.
• Only Arabic changes — English text, icons and the page layout stay exactly as the site designed them.
• Comfortable reading — raises cramped line spacing, removes letter-spacing that breaks joined letters, and lets you set the Arabic text size and word spacing.
• Correct direction — Arabic paragraphs, lists and text boxes on left-to-right sites are aligned to the right, paragraph by paragraph.
• Presets — Comfort, Compact, Naskh and Modern set everything in one click.
• Per-site control — turn Khatt off on a site, or give a site its own font and settings.
• Separate heading font — optional.
• Reading aids (off by default) — hide diacritics (tashkeel), convert numerals between 123 and ١٢٣, justify paragraphs.
• Works with Persian, Urdu and other languages written in the Arabic script.
• Available in English and Arabic.

HOW TO USE
1. Install Khatt. It starts working on every site straight away.
2. Click the Khatt icon in the toolbar to pick a font or preset and adjust the size.
3. Use "This site only" to change settings for the current site, or switch Khatt off there.
4. Click "More fonts and options" for all fonts, installed fonts, the heading font, your list of sites, and backup.

PRIVACY
Khatt collects nothing. It has no servers, no analytics and makes no network requests. Fonts are included in the extension. Your settings are saved by your browser and sync across your devices if Chrome sync is on.

PERMISSIONS
• "Read and change all your data on all websites" — Arabic text can appear on any site, so Khatt needs to run everywhere to restyle it. It looks at page text only to find Arabic characters, inside your browser. Nothing is recorded or sent anywhere.

SUPPORT
Found a problem or have a suggestion? Email [TODO: support email].
```

**Category**

Accessibility

**Single Purpose**

Improves how Arabic-script text is displayed on web pages by changing its font, spacing and direction.

**Primary Language**

English (also localised in Arabic)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `public/icon/128.png` |
| Screenshot 1 | 1280×800 | ✅ Ready | `store/screenshot-1-before-after.png` |
| Screenshot 2 | 1280×800 | ✅ Ready | `store/screenshot-2-direction.png` |
| Screenshot 3 | 1280×800 | ✅ Ready | `store/screenshot-3-popup.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store/screenshot-4-options.png` |
| Small Promo Tile | 440×280 | ✅ Ready | `store/promo-small-440x280.png` |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

Regenerate after any UI change: `npm run icons` and `npm run store-assets`.

### Screenshot Notes

All screenshots are taken from the real extension running in Chromium on local demo pages with original text.

1. **Before / after** — the same Arabic article untouched and with Khatt (default font and spacing).
2. **Direction** — an English-language feed with Arabic posts, a list and a reply box, before and with Khatt.
3. **Popup** — the real popup placed over an article. This one is a composite: the popup is captured on its own and overlaid, because the browser toolbar cannot be captured.
4. **Options page** — all fonts, installed font, heading font, sites and backup.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves the user's display choices (font, size, spacing, direction and reading-aid switches) and the list of sites where they turned the extension off or customised it, so the choices persist and sync across the user's devices. |
| `scripting` | permissions | Starts the extension in tabs that were already open when it was installed or updated, so the user does not have to refresh every open page. It only ever runs the extension's own bundled content scripts — the same ones Chrome injects on page load. |
| `<all_urls>` (host permission and content scripts) | host_permissions | The single purpose is restyling Arabic text wherever it appears, and Arabic text can appear on any site (news, social media, mail, search results, mixed-language pages), so the user cannot list sites in advance. On each page the script checks text for Arabic-script characters and marks those elements so a font and spacing rule applies to them. This happens locally; no page content is stored or transmitted. The user can turn it off per site. The host permission (rather than content-script matches alone) is what allows starting in already-open tabs, as described for `scripting`, and lets the popup read the current tab's address to show and save that site's own settings. |

**Other items a reviewer may ask about**

- **Web-accessible resources (`fonts/*`)** — the bundled font files must be loadable by the pages whose Arabic text is restyled. They are served with per-session URLs.
- **Script in the page's main world (`shadow-hook.js`, under 1 KB)** — announces when a page attaches a new shadow root to an existing element, so Arabic text inside web components is restyled too. It reads no page data and does not change how the page behaves.
- **Remote code** — none. All code and fonts are in the package; the extension makes no network requests.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

Nothing is sent to the developer or any third party, and the extension makes no network requests.

One thing to answer carefully in the dashboard form: settings are saved with Chrome's synced storage, so when the user has Chrome sync on, Google stores them with the user's account. They include the hostnames of sites the user customised. The developer never receives them. The privacy policy states this. My recommendation is to answer "No" to collecting each data type, since the developer collects nothing — but this is a judgement call that is yours to make when you fill in the form.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No (only hostnames the user chose to customise, kept in the user's own browser sync) | Only via the user's Chrome sync | Per-site settings | No |
| User activity | No | No | — | No |
| Website content | No (read locally to find Arabic text; never stored or sent) | No | — | No |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** — **TODO**: host `PRIVACY.md` at a public URL (GitHub Pages or a public gist work) and paste the link here and in the dashboard. Fill in the contact email in `PRIVACY.md` first.

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** — **TODO**

**Contact Email** — **TODO** (shown publicly; must be monitored)

**Support URL / Email** — **TODO**

**Homepage URL** — optional

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-11-14 | First version: Arabic-only font replacement with eight bundled fonts and installed-font support; text size, line height and word spacing; direction fixes; presets; per-site settings; heading font; reading aids; options page with backup; English and Arabic interface. | Draft |

## Review Notes

### Pre-publish checklist — state on 2026-11-14

Done and verified:

- Manifest V3; name and description come from the locale files and match this document; description is 129 characters.
- Permissions: `storage`, `scripting`, plus access to all sites. No `tabs` or `activeTab` permission and no remote servers.
- No remote code, no obfuscation (standard minified build), no network requests.
- Icons are real PNGs at 16, 32, 48 and 128 px.
- Package contains only the built extension: `npm run zip` → `.output/khatt-0.1.0-chrome.zip`.
- Automated tests pass: 46 unit tests and 80 tests in a real browser with the extension loaded.
- Checked on live pages: Arabic and English Wikipedia, Al Jazeera, BBC Arabic / Persian / Urdu, GitHub.

Still to do before submitting:

- **TODO** Load the build in your own Chrome and use it on the sites you actually read, especially ones that need a login (X, WhatsApp Web, Gmail, Facebook, YouTube) — these were not tested.
- **TODO** Host the privacy policy and confirm the link opens.
- **TODO** Fill in publisher name, contact and support email.
- **TODO** Decide the version number for the first public release (currently 0.1.0).

### Known Issues / Limitations

- The all-sites access will draw a closer review; the justification above is written for that.
- Urdu pages that use a Nastaliq font are restyled with the chosen Arabic font like everything else; Urdu readers may prefer to turn Khatt off on those sites.
- "List installed fonts" on the options page asks for a browser permission and has not been tested; typing a font name works.
- Text copied while "Hide diacritics" or numeral conversion is on is the rewritten text.
- With every section open, the popup is taller than Chrome's popup limit and scrolls.

### Rejection History

None.
