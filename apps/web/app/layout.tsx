import type { Metadata } from 'next';
import { Barlow_Condensed, IBM_Plex_Mono, Inter } from 'next/font/google';
import { PRODUCT_NAME } from '@receipts/core';

import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { SaveChip } from '@/components/save/SaveChip';
import { EIGHTEEN_PLUS_FOOTER_NOTICE } from '@/lib/copy';

// SW0-T2 (D-SW2): the three product faces, self-hosted by next/font (no external CDN at
// runtime — CSP-safe). Each exposes a `--font-*` CSS variable that the shared Tailwind theme
// (`packages/ui/tailwind.config.ts`) puts at the head of its font stack. `display: 'swap'`
// keeps text visible during load; the token stack is the fallback, so a slow font never
// blanks the page (and the reserved layout slots mean no shift when it lands).
const inter = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-mono',
  display: 'swap',
});
const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-display',
  display: 'swap',
});

const fontVariables = `${inter.variable} ${plexMono.variable} ${barlowCondensed.variable}`;

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: 'Timestamped, price-stamped positions on real prediction-market questions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="bg-bg text-paper font-ui flex min-h-screen flex-col">
        {/* WS17-T1 (seam 1): the app shell wraps every page — it mounts the five-room bottom tab
            bar (D-J6) once and reserves its height on the content column (no layout shift). The
            footer stays inside so INV-9's 18+ notice clears the fixed bar rather than sitting
            under it. `saveChipSlot` carries WS21-T2's neutral, value-gated Save chip (D-J8): it's a
            self-contained client component (reads its own value from `GET /me`), so filling the slot
            here keeps `layout.tsx` static — no page is made dynamic by it (seam 1). */}
        <AppShell saveChipSlot={<SaveChip />}>
          {children}
          {/* INV-9: every page footer carries an 18+ notice — that invariant is about PRESENCE,
              not a specific size, so this stays on every page but shrinks on narrow viewports
              (design-diff audit: on a short page, e.g. /nemesis's single card, the footer's full
              desktop padding/text-size read as disproportionately loud on mobile). Mobile-first:
              the compact values are the unprefixed base, `sm:` restores the original spacious
              desktop treatment. */}
          <footer className="text-muted border-surface border-t px-4 py-3 text-xs sm:py-6 sm:text-sm">
            <p>{EIGHTEEN_PLUS_FOOTER_NOTICE}</p>
          </footer>
        </AppShell>
      </body>
    </html>
  );
}
