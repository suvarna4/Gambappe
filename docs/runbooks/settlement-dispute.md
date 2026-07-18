# Settlement dispute

For a question whose venue resolution is late, wrong, or overturned after reveal (§10.3, §15.3).

- **Late resolution:** use force-settle (WS10-T3) only after `FORCE_SETTLE_MIN_AFTER_CLOSE_MIN` (30 min) past the venue market's close time, and only when the real-world outcome is independently confirmed.
- **Wrong resolution / post-reveal overturn:** void with a reason, or regrade within `REGRADE_WINDOW_H` (the post-reveal void path exists precisely for this, §5.7).
- All three actions (force-settle, void, regrade) enqueue the standard `grade:followup` + streak-replay pipeline — there's no separate manual pick-fixing path.
