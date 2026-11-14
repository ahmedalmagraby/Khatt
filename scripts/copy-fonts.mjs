// Copies the bundled font files (and their licences) from npm packages into public/fonts/.
// Run with `npm run fonts` after adding or updating a font package.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'fonts');
mkdirSync(out, { recursive: true });

const pkg = (name) => join(root, 'node_modules', ...name.split('/'));

/** [package, [[file inside package, output name], ...]] */
const sources = [
  [
    '@fontsource/ibm-plex-sans-arabic',
    [
      ['files/ibm-plex-sans-arabic-arabic-400-normal.woff2', 'ibm-plex-sans-arabic-400.woff2'],
      ['files/ibm-plex-sans-arabic-arabic-700-normal.woff2', 'ibm-plex-sans-arabic-700.woff2'],
      ['LICENSE', 'ibm-plex-sans-arabic-LICENSE.txt'],
    ],
  ],
  [
    '@fontsource-variable/vazirmatn',
    [
      ['files/vazirmatn-arabic-wght-normal.woff2', 'vazirmatn.woff2'],
      ['LICENSE', 'vazirmatn-LICENSE.txt'],
    ],
  ],
  [
    '@fontsource-variable/noto-naskh-arabic',
    [
      ['files/noto-naskh-arabic-arabic-wght-normal.woff2', 'noto-naskh-arabic.woff2'],
      ['LICENSE', 'noto-naskh-arabic-LICENSE.txt'],
    ],
  ],
  [
    '@fontsource-variable/noto-kufi-arabic',
    [
      ['files/noto-kufi-arabic-arabic-wght-normal.woff2', 'noto-kufi-arabic.woff2'],
      ['LICENSE', 'noto-kufi-arabic-LICENSE.txt'],
    ],
  ],
  [
    '@fontsource-variable/noto-sans-arabic',
    [
      ['files/noto-sans-arabic-arabic-wght-normal.woff2', 'noto-sans-arabic.woff2'],
      ['LICENSE', 'noto-sans-arabic-LICENSE.txt'],
    ],
  ],
  [
    '@fontsource-variable/readex-pro',
    [
      ['files/readex-pro-arabic-wght-normal.woff2', 'readex-pro.woff2'],
      ['LICENSE', 'readex-pro-LICENSE.txt'],
    ],
  ],
  [
    '@fontsource/tajawal',
    [
      ['files/tajawal-arabic-400-normal.woff2', 'tajawal-400.woff2'],
      ['files/tajawal-arabic-700-normal.woff2', 'tajawal-700.woff2'],
      ['LICENSE', 'tajawal-LICENSE.txt'],
    ],
  ],
  [
    '@fontsource/amiri',
    [
      ['files/amiri-arabic-400-normal.woff2', 'amiri-400.woff2'],
      ['files/amiri-arabic-700-normal.woff2', 'amiri-700.woff2'],
      ['LICENSE', 'amiri-LICENSE.txt'],
    ],
  ],
];

for (const [name, files] of sources) {
  for (const [from, to] of files) {
    const src = join(pkg(name), from);
    if (!existsSync(src)) {
      console.error(`Missing: ${src}`);
      process.exitCode = 1;
      continue;
    }
    copyFileSync(src, join(out, to));
    console.log(`fonts/${to}`);
  }
}
