import type { Settings } from './settings';

export type PresetPatch = Pick<Settings, 'fontId' | 'sizeAdjust' | 'lineHeight' | 'wordSpacing'>;

export interface Preset {
  id: string;
  /** Key in _locales messages. */
  nameKey: string;
  patch: PresetPatch;
}

/** Named bundles of font and typography settings. */
export const PRESETS: Preset[] = [
  {
    id: 'comfort',
    nameKey: 'presetComfort',
    patch: { fontId: 'ibm-plex-sans-arabic', sizeAdjust: 105, lineHeight: 1.9, wordSpacing: 0.05 },
  },
  {
    id: 'compact',
    nameKey: 'presetCompact',
    patch: { fontId: 'ibm-plex-sans-arabic', sizeAdjust: 95, lineHeight: 1.5, wordSpacing: 0 },
  },
  {
    id: 'naskh',
    nameKey: 'presetNaskh',
    patch: { fontId: 'noto-naskh-arabic', sizeAdjust: 110, lineHeight: 2, wordSpacing: 0 },
  },
  {
    id: 'modern',
    nameKey: 'presetModern',
    patch: { fontId: 'vazirmatn', sizeAdjust: 100, lineHeight: 1.7, wordSpacing: 0 },
  },
];

/** The preset whose values all match `settings`, if any. */
export function matchingPreset(settings: Settings): Preset | undefined {
  return PRESETS.find((preset) =>
    (Object.keys(preset.patch) as (keyof PresetPatch)[]).every(
      (key) => settings[key] === preset.patch[key],
    ),
  );
}
