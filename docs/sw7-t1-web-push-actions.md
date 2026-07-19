# SW7-T1 · Web-push pick actions — verification & spec gaps

Implements swipe-ux-plan §2.11 ("Web push actions") / design doc §13.2. Lets a subscriber pick
straight from a daily-open push notification's action buttons, without opening the app.

## What shipped (the mechanism)

| Piece | File | Tested by |
|---|---|---|
| Axis-ordered actions `[✕ {no}] [{yes} ✓]` + iOS capability + payload parse | `apps/worker/src/lib/notification-push-actions.ts` | `apps/worker/test/notification-push-actions.test.ts` |
| Template emits `actions` + `data` when payload carries a `pick` descriptor | `apps/worker/src/lib/notification-push-template.ts` | `apps/worker/test/notification-push-template.test.ts` |
| Transport serializes `actions`/`data` (only when present) | `apps/worker/src/lib/push-transport.ts` | `apps/worker/test/push-transport.test.ts` |
| Dispatcher strips actions + appends "tap to pick" for iOS endpoints | `apps/worker/src/jobs/notify-dispatch.ts` | `apps/worker/test/integration/notify-dispatch.test.ts` (integration) |
| Service worker: render actions, POST the pick, follow-up notifications | `apps/web/public/sw.js` | manual matrix below (see SPEC-GAP 2) |

The pick action `POST /api/v1/questions/:id/picks` carries **no client-side price** — the server
stamps it (§6.2), exactly like every other pick path. The body is just `{ side }` with the session
cookie (`credentials: 'include'`); `Sec-Fetch-Site: same-origin` on the SW's own request satisfies
`assertSameOrigin`.

### Payload contract for the (future) daily-open beat

To light up these actions, a push notification's `payload` must include:

```jsonc
{
  "line": "Fed day. Cuts or holds?",   // narrated body (as today)
  "ctaUrl": "/q/2026-07-19-fed",         // tap target (as today)
  "pick": {                              // NEW — presence is what turns on actions
    "questionId": "q_...",              // for the POST URL
    "yesLabel": "CUTS",
    "noLabel": "HOLDS",
    "url": "/q/2026-07-19-fed"          // optional; SW appends ?arm=1 on the failure path
  }
}
```

## SPEC-GAP 1 — no job emits `payload.pick` yet (the mechanism is dormant)

`question:open` (`apps/worker/src/jobs/question-open.ts`) transitions a question `scheduled → open`
and sends **no** notification — there is no "daily-open push" beat in the system, so nothing sets
`payload.pick` today. This task delivers the *ready* mechanism (worker → transport → service
worker); wiring the trigger is a follow-up that needs a per-open push beat adjacent to WS9's reveal
beats, which is outside the swipe-UX plan's SP3 scope. Everything here is a no-op until that beat
exists, and cannot regress any current beat (their serialized payload is byte-identical — the
`actions`/`data` keys are spread in only when a `pick` descriptor is present).

## SPEC-GAP 2 — no service-worker E2E infra → manual matrix

Real Web Push needs VAPID keys, a push service, an installed service worker, and (for iOS) a real
device — none of which the repo's Playwright/CI stack provides. The worker-side logic is unit-tested
(above); the **service-worker behavior is verified by the manual matrix below**. Re-run it whenever
`apps/web/public/sw.js` changes.

### Local setup

1. `npx web-push generate-vapid-keys` → set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (+ the
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` the client reads), `NEXT_PUBLIC_APP_URL`, flag `web_push=on`.
2. Load the app over HTTPS (or `localhost`, which browsers treat as a secure context), opt in via
   Settings → push, confirm a `push_subscriptions` row exists.
3. Send a test push whose payload matches the contract above (a throwaway `web-push send` script or
   a temporary `sendNotification(..., { push })` call with a `pick` descriptor).

### Matrix

| Platform | Actions shown? | Tap `✓ {yes}` (returning user) | First-ever pick (age gate) | Double-tap same action | Offline / 5xx |
|---|---|---|---|---|---|
| Android Chrome | yes, `[✕ no][yes ✓]` | 201 → "You're in — {yes} @ N¢" | POST 4xx → "Finish your pick" deep-links `?arm=1` | 2nd tap → 409 → "Already called." | catch → "Finish your pick" |
| Desktop Chrome | yes | same | same | same | same |
| Desktop Firefox | yes | same | same | same | same |
| iOS Safari (PWA) | **no** (Apple endpoint) | n/a — body ends " — tap to pick", tap deep-links | tap deep-links `ctaUrl` | n/a | n/a |

### Axis check (D-SW9, the plan's hard requirement)

Left action = `pick:no` (against, `✕`), right action = `pick:yes` (for, `✓`) — the **same** left/right
meaning as the ballot's tap wells and the swipe throw. `notification-push-actions.test.ts` pins the
order; visually confirm the tray renders `✕ {no}` left of `{yes} ✓`.

## Notes

- The SW's own confirmation/fallback strings ("You're in.", "Finish your pick", …) live inline in
  `sw.js` because a static service worker cannot import `apps/web/lib/copy.ts` (§2.12's single-file
  copy rule applies to bundled app code). The worker-emitted title/body still come from the payload
  (`narrate()` output), and the action button labels come from the question's own yes/no labels.
- Double-tap idempotency rides on the pick endpoint's existing `ALREADY_PICKED` (409) semantics
  (§6.2) — the SW treats 409 as "done", not an error.
