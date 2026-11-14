# Khatt (خط) — Chrome extension for beautiful Arabic text on any website

## Context

Arabic text on most websites is rendered with whatever fallback font the OS picks (often Tahoma/Arial/Segoe UI), with Latin-tuned line height, letter-spacing that breaks letter joining, and wrong direction on LTR-first sites (chat apps, GitHub, social feeds). Khatt fixes this everywhere: it swaps in a high-quality Arabic font, tunes typography for Arabic, repairs direction/alignment, and adds optional reading aids — **touching only Arabic text and leaving Latin text, icons and page layout alone**.

The project folder was empty; this is a greenfield build.

**Decisions made**

| Topic | Decision |
|---|---|
| Fonts | Bundled open-licensed fonts + any font installed on the user's computer (no network requests) |
| Activation | All sites by default, per-site opt-out |
| Stack | TypeScript + WXT (Vite), Manifest V3 |
| v1 scope | Font replacement, typography tuning, RTL fixes, per-site settings, reading extras |

---

## Core technical approach

### 1. Arabic-only font replacement (the key idea)

- Declare the chosen font under a private family name with a `unicode-range` limited to Arabic blocks:
  `U+0600-06FF, U+0750-077F, U+0870-089F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF` (+ `U+200C-200F`).
  Because of `unicode-range`, Latin characters, digits and icon-font glyphs never use it.
- A content script finds elements that **directly contain Arabic text nodes** and tags them with `data-khatt="<n>"`, where `n` identifies the element's original computed `font-family` stack.
- A generated stylesheet has one rule per distinct stack:
  `[data-khatt="3"] { font-family: "Khatt Arabic", <original stack> !important; }`
  So the site's own fonts remain the fallback for everything non-Arabic. Pages typically have only a handful of distinct stacks.
- Headings (`h1–h6` and descendants) can use a separate `"Khatt Arabic Heading"` family.
- Skipped: `script, style, noscript, svg, pre, code, kbd, samp`, and anything inside an element with `data-khatt-ignore`.
- Attributes (not classes) are used so frameworks that rewrite `className` do not wipe the tag.

### 2. Size without breaking layout

Arabic size is controlled with the `size-adjust` descriptor on the `@font-face`, not `font-size` on elements. This scales only Arabic glyphs, leaves Latin untouched, and each bundled font ships a default `size-adjust` so fonts are optically matched when switching.

### 3. Typography tuning

- On all tagged elements: `letter-spacing: 0 !important` (letter-spacing breaks Arabic joining), `font-kerning: normal`, `text-rendering: optimizeLegibility`, user `word-spacing`.
- Line height is applied **only to prose** (tagged `data-khatt-prose`: `p, li, blockquote, dd, td`, or text longer than ~80 characters) so buttons, nav bars and badges do not change height.
- Optional font-weight nudge (e.g. lighten overly bold Arabic headings).

### 4. RTL / direction fixes (conservative by design)

- Never change `dir` on `html`/`body` or flip page layout. If the page root is already RTL, direction fixing is skipped.
- Text blocks that contain Arabic and are in an LTR context get `unicode-bidi: plaintext; text-align: start` — each paragraph then picks its own direction from its first strong character, so mixed Arabic/English feeds resolve correctly per paragraph. Only applied when the computed `text-align` is `start`/`left` (never override centered or deliberately aligned text).
- Lists whose items are predominantly Arabic get `direction: rtl` so bullets/numbers move to the right side.
- `input` and `textarea` without an explicit `dir` get `dir="auto"`. `contenteditable` editors get fonts only, no direction changes (too risky).

### 5. Reading extras (all off by default)

Two reversible text transforms share one engine that stores the original string per text node in a `WeakMap` and restores it when toggled off; they never run inside inputs or editable regions:

- **Hide tashkeel** — strips `U+064B–U+0652`, `U+0670`.
- **Numeral conversion** — Western ↔ Arabic-Indic digits inside Arabic-tagged elements.

Plus:
- **Presets** — named bundles of settings ("Comfort", "Compact", "Naskh reading", "Modern sans").
- **Justify prose** — `text-align: justify` on prose blocks, labelled experimental.

Not in v1 (documented as limitations): *dimming* tashkeel (CSS cannot colour combining marks separately) and true kashida justification (Chrome has no native support; inserting tatweel corrupts copy/search).

### 6. Engine mechanics

- Content script runs at `document_start`, `all_frames: true`, `match_origin_as_fallback: true`; injects the stylesheet immediately to avoid a flash of the old font.
- Initial pass with a `TreeWalker` over text nodes, processed in chunks via `requestIdleCallback`/`requestAnimationFrame`, with reads (`getComputedStyle`) and writes (attributes) in separate phases to avoid layout thrash.
- `MutationObserver` (`childList`, `characterData`, subtree) handles SPAs and infinite scroll; mutations are queued and batched. A cheap Arabic regex test on added text exits early on pages with no Arabic.
- Open shadow roots: observed and given a copy of the stylesheet (`@font-face` stays at document level).
- Settings reach the page via `chrome.storage` + `storage.onChanged` — live updates with no messaging and no `tabs` permission.
- Turning Khatt off for a site removes every attribute, style and text transform (full clean revert).

### 7. Fonts

- Bundled as WOFF2 (variable where available) in `public/fonts/`, exposed via `web_accessible_resources`, each with its OFL licence file. Target total package under ~5 MB.
- Candidate set (final pick after visual review): IBM Plex Sans Arabic, Noto Sans Arabic, Noto Naskh Arabic, Vazirmatn, Readex Pro, Amiri, Noto Kufi Arabic, Tajawal.
- **System fonts:** `@font-face { src: local("<name>") }` under the same private family. The options page lists installed fonts through the Local Font Access API (`queryLocalFonts()`) when permitted, with a free-text name field as fallback. The system-font choice is stored in `storage.local` (device-specific).

### 8. Settings model

- `storage.sync`: `global` settings object, plus one key per site (`site:<hostname>`) holding `{ enabled, overrides }` — separate keys stay within the per-item sync quota.
- Effective settings = defaults ← global ← site overrides. Schema carries a `version` for migrations in `runtime.onInstalled`.

### 9. Permissions

`storage`, `activeTab` (popup reads the current hostname on click), content script on `<all_urls>`. No `tabs`, no remote hosts, no data collection.

---

## Project structure (WXT)

```
Khatt/
  PLAN.md
  wxt.config.ts               manifest: permissions, web_accessible_resources, locales
  entrypoints/
    background.ts             install defaults, settings migration, toggle keyboard command
    content/
      index.ts                bootstrap, settings subscription, enable/disable lifecycle
      scanner.ts              TreeWalker + MutationObserver + batching
      tagger.ts               font-stack registry, data-khatt attributes, prose detection
      styles.ts               stylesheet + @font-face generation, shadow-root injection
      direction.ts            RTL / alignment fixes
      transforms.ts           reversible tashkeel / numeral transforms
    popup/                    site toggle, font picker with live preview, sliders, presets
    options/                  font management, system fonts, site list, extras, import/export
  lib/
    arabic.ts                 script detection regex, Arabic-ratio helpers
    settings.ts               schema, defaults, merge, storage wrappers
    fonts.ts                  bundled font registry (file, weights, default size-adjust)
    presets.ts
  public/
    fonts/  _locales/{ar,en}/  icons/ (16, 32, 48, 128 real PNGs)
  tests/
    unit/                     vitest: detection, settings merge, transforms
    e2e/                      Playwright with the built extension + fixture pages
```

UI is plain TypeScript + CSS (no framework), bilingual Arabic/English via `_locales`, with the popup itself laid out RTL-aware.

---

## Phases

1. **Scaffold** — save `PLAN.md`, `npx wxt@latest init`, TypeScript, lint, vitest; placeholder icons.
2. **Font engine skeleton** — detection, tagging, stylesheet, one bundled font, working on static and dynamic pages.
3. **Settings + popup** — storage model, site on/off, font picker, live updates, clean revert.
4. **Typography + RTL** — size-adjust, prose line height, spacing, direction fixes, input `dir="auto"`.
5. **Reading extras** — transform engine, tashkeel, numerals, presets, justify.
6. **Options page** — full font set, system fonts, heading font, site list, import/export, i18n.
7. **Hardening** — shadow DOM, iframes, performance budget, compatibility matrix, e2e tests.
8. **Store prep** — final icons, `CHROMEWEBSTORE.md` (listing copy, justification for the all-sites permission), privacy policy, screenshots, `wxt zip`.

---

## Risks to verify early (phase 2)

- **Strict-CSP sites** (GitHub, X): confirm extension-hosted fonts and the injected `<style>` load. Fallbacks: load fonts through the `FontFace` API from the content script; inject CSS through `chrome.scripting.insertCSS` (adds the `scripting` permission).
- **Framework re-renders** removing attributes or reverting transformed text — the observer re-applies; watch for loops.
- **Sites using `!important` or inline font styles** — may need a specificity bump.
- **Persian/Urdu pages** share the Arabic script; font replacement applies to them too. Language-specific fonts (Nastaliq) are a later addition.
- **Web Store review** of the all-sites permission — mitigated by no network use and a clear single purpose.

---

## Verification

- `npm run dev` — WXT launches Chrome with the extension and hot reload.
- `npm test` — unit tests for detection, settings merge, reversible transforms (transform → restore must equal original).
- `npm run test:e2e` — Playwright fixtures: pure Arabic page, mixed LTR page with Arabic paragraphs, dynamically inserted content, shadow DOM, iframe, icon fonts, form inputs.
- Manual compatibility matrix: ar.wikipedia.org, aljazeera.net, X, YouTube comments, GitHub (Arabic README), Google Search, WhatsApp Web, Gmail, Facebook, an AI chat UI, BBC Persian/Urdu. For each: Arabic uses the chosen font, Latin and icons unchanged, layout not shifted, toggle-off fully reverts.
- Performance: on a long Arabic Wikipedia article, no long task over ~50 ms from Khatt in the DevTools Performance panel; negligible cost on pages with no Arabic.
