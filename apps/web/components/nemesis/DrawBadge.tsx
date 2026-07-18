/**
 * A "draw" badge in the same visual language as `@receipts/ui`'s `Stamp` (rotated bordered
 * label) — `Stamp`'s variants are `win`/`loss`/`void`/`called_it` (§10.4), none of which mean
 * "draw" (a pairing-level tie, not a pick result), so this is a small local sibling rather
 * than a misuse of an existing `Stamp` variant.
 */
export function DrawBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`border-muted text-muted inline-block -rotate-6 rounded border-2 px-3 py-1 text-sm font-bold tracking-widest uppercase ${className}`}
    >
      Draw
    </span>
  );
}
