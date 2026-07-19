/**
 * §8.6 daily percentile formula (WS3-T5). Pure function: `scores` are graded picks' `edge`
 * values for a single question, already filtered by the caller to exclude
 * `bot_score >= BOT_EXCLUDE_THRESHOLD` profiles (§8.6: excluded profiles never appear in
 * others' denominators). Returns one percentile per input score, same index alignment.
 *
 * `percentile(x) = (count(s_y < s_x) + 0.5*count(s_y = s_x, y != x)) / (N-1) * 100`, N=1 → 100.
 *
 * O(n log n): sort once, then every member of a tie group shares
 * `(countBelowGroup + 0.5*(groupSize-1)) / (N-1) * 100` — algebraically identical to the
 * pairwise definition above. This runs on the web reveal path (percentile cache-miss fallback,
 * `apps/web/lib/percentile.ts`), where the old O(n²) pairwise loop meant seconds of synchronous
 * event-loop blockage per cold-cache request once a question had tens of thousands of picks.
 */
export function computePercentiles(scores: readonly number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  // NaN-safe total ordering (NaN sorts last): `a - b` returns NaN for NaN operands, which
  // Array#sort treats as an inconsistent comparator — that can split REAL tie groups apart and
  // corrupt other members' percentiles, not just the NaN's own. With NaN-last, every finite
  // member's percentile is exactly the §8.6 value it would get if the NaN rows simply didn't
  // compare (matching the old pairwise implementation, where NaN comparisons were always false);
  // each NaN gets a deterministic own-group slot. NaN here means corrupt data (a literal NaN in
  // a pg numeric `edge`) — tolerated without contaminating everyone else, not endorsed.
  const order = Array.from(scores.keys()).sort((a, b) => {
    const sa = scores[a]!;
    const sb = scores[b]!;
    const aNaN = Number.isNaN(sa);
    const bNaN = Number.isNaN(sb);
    if (aNaN || bNaN) return aNaN === bNaN ? 0 : aNaN ? 1 : -1;
    return sa - sb;
  });
  const result = new Array<number>(n);
  let groupStart = 0;
  while (groupStart < n) {
    const value = scores[order[groupStart]!]!;
    let groupEnd = groupStart + 1;
    while (groupEnd < n && scores[order[groupEnd]!] === value) groupEnd++;
    const groupSize = groupEnd - groupStart;
    const percentile = ((groupStart + 0.5 * (groupSize - 1)) / (n - 1)) * 100;
    for (let k = groupStart; k < groupEnd; k++) result[order[k]!] = percentile;
    groupStart = groupEnd;
  }
  return result;
}

/** "Top X%" display per §8.6: X = 100 − percentile, floored at 1 ("Top 1%" is the best shown). */
export function topPercentDisplay(percentile: number): number {
  return Math.max(1, Math.round(100 - percentile));
}
