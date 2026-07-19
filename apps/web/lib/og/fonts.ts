/**
 * SW0-T2 · Satori font registration for the display face (swipe-ux-plan §2.1).
 *
 * The `/api/og/*` and `/api/cards/*` routes render with satori (via `next/og`), which needs
 * raw font buffers — `next/font` (which powers the live app) can't help here. This loads the
 * locally committed Barlow Condensed TTFs (OFL, `./fonts/OFL.txt`) so card templates can set
 * `fontFamily: 'Barlow Condensed'`.
 *
 * Nothing references this yet: SW4-T2 (the Print-Shop template restyle) is what actually puts
 * Barlow into the card layouts and passes these descriptors to `renderOgImage`/`renderCardImage`.
 * Wiring it here (not there) is deliberate — SW0-T2 owns "make the face available everywhere",
 * SW4-T2 owns "use it". Because the existing templates don't name this family, registering it
 * has no effect on current OG output.
 *
 * These routes run on the Node runtime (see `render.tsx`'s SPEC-GAP note), so `fs` is available.
 * The TTFs sit next to this module; `import.meta.url` resolves them regardless of `process.cwd()`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: 'normal';
}

function read(file: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`./fonts/${file}`, import.meta.url)));
}

let cache: SatoriFont[] | null = null;

/**
 * The brand faces embedded for satori card templates (SW4-T2): Barlow Condensed (display —
 * headlines/stamps) and IBM Plex Mono (the "printed" numerals/prices), loaded once per server
 * process. Registering the real faces resolves the WS8-T1 SPEC-GAP where OG output fell back to
 * next/og's bundled Noto Sans. Weights sit under one family name each so satori matches on the
 * element's `fontWeight`; the family names match the `fontFamily` strings the templates set.
 */
export function loadDisplayFonts(): SatoriFont[] {
  if (!cache) {
    cache = [
      {
        name: 'Barlow Condensed',
        data: read('BarlowCondensed-Medium.ttf'),
        weight: 500,
        style: 'normal',
      },
      {
        name: 'Barlow Condensed',
        data: read('BarlowCondensed-Bold.ttf'),
        weight: 700,
        style: 'normal',
      },
      {
        name: 'IBM Plex Mono',
        data: read('IBMPlexMono-Regular.ttf'),
        weight: 400,
        style: 'normal',
      },
      {
        name: 'IBM Plex Mono',
        data: read('IBMPlexMono-SemiBold.ttf'),
        weight: 600,
        style: 'normal',
      },
    ];
  }
  return cache;
}
