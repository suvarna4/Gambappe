import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Receipts',
  description: 'Timestamped, price-stamped positions on real prediction-market questions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* INV-9: every page footer carries an 18+ notice. */}
        <footer>
          <p>18+ only. Receipts never holds money — picks are for competition, not wagers.</p>
        </footer>
      </body>
    </html>
  );
}
