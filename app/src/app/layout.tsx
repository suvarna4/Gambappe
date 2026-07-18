import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Receipts",
  description: "Timestamped, price-stamped predictions. Public by design. Never money.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <div className="mx-auto max-w-[480px] min-h-screen flex flex-col px-4 pb-24 pt-6">
          {children}
        </div>
        <footer className="fixed bottom-0 inset-x-0 text-center text-xs text-[var(--ink-dim)] py-3 bg-[var(--bg)]/90 border-t border-[var(--border)]">
          18+ · Receipts never handles money.
        </footer>
      </body>
    </html>
  );
}
