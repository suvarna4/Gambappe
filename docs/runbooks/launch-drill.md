# Launch drill

Pre-launch (Question Zero) checklist (§18).

- Load test (`WS14-T2`) gates launch: spectator page burst (500 rps / 2 min, p95 < 300ms) and the reveal-minute API spike must pass before go-live.
- Confirm ISR + CDN is serving the spectator page — pick creation is the only hot write path.
- Walk through the full golden loop end-to-end on staging: spectator view → pick as a fresh ghost → lock → reveal → share card → claim → profile history.
- Verify `/admin/ops` shows every job healthy (no stale/erroring rows) before opening traffic.
