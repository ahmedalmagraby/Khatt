import { browser } from 'wxt/browser';
import { cleanFontName, fontFaceCss } from './css';
import { BUNDLED_FONTS, SYSTEM_FONT_ID } from './fonts';

/** Shared helpers for the extension's own pages (popup, options). */

/** Localised message; `substitutions` fill $1, $2… in the message. */
export const t = (key: string, ...substitutions: string[]): string =>
  browser.i18n.getMessage(key as never, substitutions) || key;
export const isArabicUi = browser.i18n.getUILanguage().startsWith('ar');

export const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Sets the page language/direction and fills every `data-i18n` element. */
export function localize(): void {
  document.documentElement.lang = isArabicUi ? 'ar' : 'en';
  document.documentElement.dir = isArabicUi ? 'rtl' : 'ltr';
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n!);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder!));
  }
}

export const fontUrl = (file: string): string =>
  browser.runtime.getURL(`/fonts/${file}` as never);

const previewFamily = (id: string) => `Khatt Preview ${id}`;

/** Declares one preview family per bundled font so samples can be shown in their own font. */
export function injectPreviewFaces(): void {
  const style = document.createElement('style');
  style.textContent = BUNDLED_FONTS.map((font) =>
    fontFaceCss(font, 100, fontUrl, previewFamily(font.id)),
  ).join('\n');
  document.head.append(style);
}

export interface FontChoice {
  id: string;
  label: string;
  /** CSS font-family value used to draw the sample. */
  family: string;
}

/** The bundled fonts, plus the system font when one has been named on this device. */
export function fontChoices(systemFont: string): FontChoice[] {
  const choices: FontChoice[] = BUNDLED_FONTS.map((font) => ({
    id: font.id,
    label: isArabicUi ? font.nameAr : font.name,
    family: `"${previewFamily(font.id)}", sans-serif`,
  }));
  const system = cleanFontName(systemFont);
  if (system) {
    choices.push({ id: SYSTEM_FONT_ID, label: system, family: `"${system}", sans-serif` });
  }
  return choices;
}

/** Fills `container` with one selectable card per font choice. */
export function renderFontCards(
  container: HTMLElement,
  choices: FontChoice[],
  sampleText: string,
  onSelect: (id: string) => void,
): void {
  container.replaceChildren(
    ...choices.map((choice) => {
      const label = document.createElement('label');
      label.className = 'font';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'font';
      input.value = choice.id;
      input.addEventListener('change', () => onSelect(choice.id));

      const sample = document.createElement('span');
      sample.className = 'sample';
      sample.lang = 'ar';
      sample.textContent = sampleText;
      sample.style.fontFamily = choice.family;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = choice.label;

      label.append(input, sample, name);
      return label;
    }),
  );
}

export function checkFontCard(container: HTMLElement, fontId: string): void {
  for (const input of container.querySelectorAll<HTMLInputElement>('input[name="font"]')) {
    input.checked = input.value === fontId;
  }
}
