# fixtures/

Recorded venue API responses and golden vectors (design doc §4.1, §7.2, §17.2).

Layout:

- `kalshi/*.json` — recorded Kalshi API responses (WS1-T2 records these; `RECORD_FIXTURES=1`
  script refreshes them manually). CI never hits real venues.
- `polymarket/*.json` — recorded Polymarket Gamma/CLOB responses (WS1-T3).
- `golden/` — golden vectors for engine math (e.g. the §8.3 Glicko-2 vector, fingerprint
  hand-computed vectors; owned by WS4 tasks).
- `venue-notes.md` — verified venue rate limits & endpoints, recorded by WS1 (§7.2).

Rules:

- Fixtures are committed and immutable within a task; refresh via the record script only.
- Trim recorded payloads to the fields adapters actually read (ToS posture, §5.3 `raw`).
