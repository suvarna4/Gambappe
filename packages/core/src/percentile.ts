/**
 * §8.6 daily percentile formula (WS3-T5). Pure function: `scores` are graded picks' `edge`
 * values for a single question, already filtered by the caller to exclude
 * `bot_score >= BOT_EXCLUDE_THRESHOLD` profiles (§8.6: excluded profiles never appear in
 * others' denominators). Returns one percentile per input score, same index alignment.
 *
 * `percentile(x) = (count(s_y < s_x) + 0.5*count(s_y = s_x, y != x)) / (N-1) * 100`, N=1 → 100.
 */
export function computePercentiles(scores: readonly number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  return scores.map((sx, i) => {
    let lower = 0;
    let tiedOthers = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const sy = scores[j]!;
      if (sy < sx) lower++;
      else if (sy === sx) tiedOthers++;
    }
    return ((lower + 0.5 * tiedOthers) / (n - 1)) * 100;
  });
}

/** "Top X%" display per §8.6: X = 100 − percentile, floored at 1 ("Top 1%" is the best shown). */
export function topPercentDisplay(percentile: number): number {
  return Math.max(1, Math.round(100 - percentile));
}
