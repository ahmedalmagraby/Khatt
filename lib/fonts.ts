export interface FontFaceFile {
  /** File name inside public/fonts/. */
  file: string;
  /** CSS font-weight descriptor: a single weight or a range such as "100 900". */
  weight: string;
}

export interface BundledFont {
  id: string;
  name: string;
  nameAr: string;
  faces: FontFaceFile[];
  /** Optical size correction in percent, so fonts look the same size when switched. */
  sizeAdjust: number;
}

export const BUNDLED_FONTS: BundledFont[] = [
  {
    id: 'ibm-plex-sans-arabic',
    name: 'IBM Plex Sans Arabic',
    nameAr: 'آي بي إم بلكس',
    faces: [
      { file: 'ibm-plex-sans-arabic-400.woff2', weight: '400' },
      { file: 'ibm-plex-sans-arabic-700.woff2', weight: '700' },
    ],
    sizeAdjust: 100,
  },
  {
    id: 'vazirmatn',
    name: 'Vazirmatn',
    nameAr: 'وزير متن',
    faces: [{ file: 'vazirmatn.woff2', weight: '100 900' }],
    sizeAdjust: 96,
  },
  {
    id: 'noto-naskh-arabic',
    name: 'Noto Naskh Arabic',
    nameAr: 'نوتو نسخ',
    faces: [{ file: 'noto-naskh-arabic.woff2', weight: '400 700' }],
    sizeAdjust: 106,
  },
  {
    id: 'noto-kufi-arabic',
    name: 'Noto Kufi Arabic',
    nameAr: 'نوتو كوفي',
    faces: [{ file: 'noto-kufi-arabic.woff2', weight: '100 900' }],
    sizeAdjust: 90,
  },
  {
    id: 'noto-sans-arabic',
    name: 'Noto Sans Arabic',
    nameAr: 'نوتو سانس',
    faces: [{ file: 'noto-sans-arabic.woff2', weight: '100 900' }],
    sizeAdjust: 95,
  },
  {
    id: 'readex-pro',
    name: 'Readex Pro',
    nameAr: 'ريدكس برو',
    faces: [{ file: 'readex-pro.woff2', weight: '160 700' }],
    sizeAdjust: 90,
  },
  {
    id: 'tajawal',
    name: 'Tajawal',
    nameAr: 'تجوال',
    faces: [
      { file: 'tajawal-400.woff2', weight: '400' },
      { file: 'tajawal-700.woff2', weight: '700' },
    ],
    sizeAdjust: 97,
  },
  {
    id: 'amiri',
    name: 'Amiri',
    nameAr: 'أميري',
    faces: [
      { file: 'amiri-400.woff2', weight: '400' },
      { file: 'amiri-700.woff2', weight: '700' },
    ],
    sizeAdjust: 110,
  },
];

export const DEFAULT_FONT_ID = 'ibm-plex-sans-arabic';
/** fontId meaning "the font installed on this computer whose name is stored locally". */
export const SYSTEM_FONT_ID = 'system';

export function getFont(id: string): BundledFont {
  return BUNDLED_FONTS.find((f) => f.id === id) ?? BUNDLED_FONTS[0]!;
}
