# Native surfaces feasibility spike (SW7-T3)

Doc only — no code in this task. Maps each surface in `docs/mockups/swipe-ux.html` §03's
platform truth table (and the §02 Live-Activity "sweat" frame) to what the current platform
APIs actually let us build, what a wrapper strategy would cost, and a go/no-go per surface for
a future plan revision. Written against SW1/SW7 in-flight (`web_push` flag, `PickButtons`,
`apps/web/public/sw.js`) rather than the swipe deck itself, since none of these surfaces can
render a drag gesture — every one of them is a tap-well or display-only equivalent, per D-SW9's
side-axis rule (NO on the visual left, YES on the visual right, applied consistently below —
correcting the mock's own §03/§02 exhibit frames, which show YES-first in a couple of spots and
are proposals, not implemented UI, per `docs/mockups/README.md`).

Every claim below is checked against current (2026) platform documentation; sources are cited
inline. No surface here is scoped into the SW0–SW8 DAG beyond SW7-T1 (web push actions) and
SW7-T2 (pre-armed deep links), both already in the ready queue — this doc exists so a future
revision can schedule the rest with real cost numbers instead of guesses.

## 1. iOS notification actions

**The move:** long-press (or force-touch) a notification to reveal two action buttons —
`✕ {no_label}` on the left, `{yes_label} ✓` on the right — and pick without unlocking past the
lock screen.

**API:** `UNNotificationCategory` with two `UNNotificationAction`s, registered at app launch and
attached to the pushed `UNMutableNotificationContent.categoryIdentifier`; the app's notification
service extension (or main target's `UNUserNotificationCenterDelegate`) handles the action
identifier in `didReceive response:` and fires the pick network call itself — the OS does not
make the request for you. ([UserNotifications docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers))

**Honest constraint:** this requires the **native** notification path (APNs + a real iOS app
target with a notification extension) — it is not reachable from web push at all. Safari's web
push on iOS (16.4+) delivers the notification but iOS suppresses custom actions entirely: only a
generic "View" action shows, and `event.notification.data`/action identifiers never reach the
service worker's `notificationclick` handler. This is a hard platform wall, not a bug to work
around — multiple independent reports confirm iOS Safari silently drops declared `actions`
arrays. ([Apple Developer Forums thread](https://developer.apple.com/forums/thread/726793))
Practically: **this surface requires shipping a native iOS app** (see §6 wrapper discussion) —
there is no PWA/web-push path to it.

**Cost estimate:** a notification service extension + category registration is a small, well-
trodden native surface (1–2 eng-weeks once a native shell exists at all) — but it is gated
entirely behind "does a native app target exist," which is the expensive part (§6).

## 2. Interactive home-screen widget (App Intents)

**The move:** the daily question's headline plus two tap wells, live on the home screen — a pick
without opening the app at all, exactly like the mock's widget exhibit.

**API:** WidgetKit's interactive-widget model (iOS 17+): a `Button(intent:)` or
`Toggle(isOn:intent:)` inside the widget's SwiftUI view, backed by an `AppIntent` whose
`perform()` runs in the widget extension process (not the main app) and then the system reloads
the widget's timeline. This model is unchanged through iOS 26 — Apple's 2026 UI refresh
(Liquid Glass rendering) is cosmetic, not a change to the interactivity contract.
([WidgetKit: Adding interactivity to widgets and Live Activities](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities))

**Honest constraint:** no drag physics — `Button(intent:)` is a tap, full stop. The widget's
price display is a timeline snapshot (WidgetKit refreshes on a budget, not live), so exactly as
the mock's own caption states, **the pick's actual price must be confirmed server-side at tap
time** — the widget shows a preview price, never a promise. This is consistent with the app's
existing invariant that price is stamped by the server at write time (design doc §6.2), so no
new server-side idea is needed here, only a client target that can call the existing pick
endpoint from an App Intent's `perform()`.

**Cost estimate:** requires a Widget Extension target (Swift/SwiftUI) plus an `AppIntent` that
performs an authenticated network call — moderate (2–4 eng-weeks including the auth-token
plumbing from the main app's session into the extension's keychain access group), and, like §1,
gated behind a native app existing.

## 3. Live Activity / Dynamic Island reveal

**The move:** from lock time, a Live Activity holds the lock screen and (on Dynamic-Island
hardware) the island — live price on the left, countdown on the right; at reveal it expands and
stamps the outcome, matching the mock's "the reveal reaches the table before your hand does"
frame.

**API:** `ActivityKit`, started from the app (or, since iOS 17.2, started **remotely** via an
ActivityKit push-to-start token) and updated remotely via push using the activity's push token —
no need for the app to be foregrounded to advance the countdown or fire the reveal stamp.
([ActivityKit: Starting and updating Live Activities with push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications))

**Honest constraint:** display + tap only, as the mock itself says — ActivityKit has no
interactive-button equivalent of App Intents widgets; a tap always opens the app (pre-armed, per
SW7-T2's `?arm=1` contract), it never submits a pick itself. Apple also rate-limits ActivityKit
push updates per activity ("notification budget"), so a naive "push every price tick" design
would get throttled — the reveal-moment update (one push, `apns-priority: 10`) is well within
budget, but a live ticking price throughout the evening is not free and should be either
client-side countdown math (server-offset pattern, already used elsewhere in this app) with only
start/reveal pushed remotely, or a deliberately coarse price-refresh cadence.

**Cost estimate:** the highest of the four — a Live Activity widget extension, ActivityKit
push-token registration/storage server-side, and a worker job to fire the reveal-time push in
sync with the existing `reveal:fire` job. 3–5 eng-weeks, native-app-gated.

## 4. Apple Watch actions

**The move:** the same two action wells arrive on the wrist.

**API:** watchOS shares `UNNotificationCategory`/`UNNotificationAction` with iOS — a category
registered by the iOS app is available to the paired watch automatically for notification
actions with no separate watch-side registration. Watch complications (the watch-face glanceable
surface, as opposed to notification actions) are a separate WidgetKit surface
(`AccessoryCircular`/`AccessoryRectangular`/`AccessoryInline`/`AccessoryCorner` families) shared
with iOS's Lock Screen widgets since watchOS 9.
([WidgetKit: Creating accessory widgets and watch complications](https://developer.apple.com/documentation/widgetkit/creating-accessory-widgets-and-watch-complications))

**Honest constraint:** as the mock notes, this is buttons, not a gesture — same tap-well
semantics as §1. A complication (as opposed to the notification action) is display-only, same
constraint as §3's Dynamic Island. Needs an actual watchOS app target, not just an iOS one — a
paired-but-not-installed watch does not automatically get either surface.

**Cost estimate:** the notification-action path piggybacks on §1's work almost for free (same
category, watch inherits it). A dedicated complication is a separate small watchOS app target,
roughly on par with §2's estimate once §1's native shell exists.

## 5. Wrapper strategy: Capacitor vs. a native shell

This is where the real cost lives, and it's shared across §1, §2, §3, and half of §4 — none of
them exist without *some* native compile target.

**What a JS-first wrapper (Capacitor) actually buys:** the main app screens stay the existing
Next.js web app inside a WKWebView — no rewrite. But `ActivityKit`, `WidgetKit`, and
`UNNotificationAction` registration are Swift/UIKit-or-SwiftUI-only frameworks; no JS/WebView
bridge can execute inside a Widget Extension or Live Activity process (they're separate OS
processes/extensions, not the app's WebView). Community plugins now cover this gap —
`@capgo/capacitor-widget-kit` and `@capgo/capacitor-live-activity`/`capacitor-live-activities`
wrap WidgetKit/ActivityKit behind a Capacitor plugin API, with the widget itself either
SVG-templated (Capacitor owns the JSON state, no Swift UI code) or "full-native" (a real
SwiftUI widget view, Capacitor only ships state across the bridge).
([Capgo: Live Activities Capacitor plugin](https://capgo.app/plugins/capacitor-live-activities/),
[Implementing a native bridge for iOS in Capacitor](https://capgo.app/blog/implementing-native-bridge-for-ios-in-capacitor/))

**Honest constraint:** even the SVG-templated route still needs an Xcode project with a Widget
Extension target and Apple Developer Program enrollment (App Groups for shared state, an
extension bundle ID, provisioning) — Capacitor removes the *SwiftUI layout* work for simple
widgets, not the *native target/build/signing* work, and it buys nothing for §1's notification
actions (that's plain `UNNotificationCategory` API, already reachable from Capacitor's own local/
push-notification plugins with no widget-kit plugin needed). For §3's full-native Live Activity
UI (the mock's expand-at-reveal choreography, not a generic SVG card), the "full-native session"
mode is recommended by the plugin's own docs — meaning close to the same SwiftUI investment as
a bespoke native shell, just with Capacitor handling app↔widget state sync.

**Net take:** Capacitor is worth it for the *shared app shell* (one non-web codebase to
maintain instead of a whole separate native app), and worth it for §1 (notification actions)
essentially for free. It meaningfully discounts §2/§4 (simple tap-well widgets/complications can
stay SVG-templated). It does **not** discount §3 (the reveal choreography wants full-native
SwiftUI regardless of wrapper) below a genuinely native build.

## 6. Cost estimate summary

| Surface | Gate | Eng estimate (once a native shell exists) | Native shell required? |
|---|---|---|---|
| iOS notification actions (§1) | none beyond a native app target | 1–2 wk | Yes |
| Watch notification actions (§4a) | rides on §1 | ~free | Yes (paired watch app) |
| Interactive widget (§2) | none | 2–4 wk | Yes (Capacitor SVG mode discounts this) |
| Watch complication (§4b) | none | 2–3 wk | Yes (separate watchOS target) |
| Live Activity / Dynamic Island (§3) | ActivityKit push budget design | 3–5 wk | Yes (full-native regardless of wrapper) |
| **Standing up the shell itself** (Capacitor + Xcode project + App Store enrollment + review) | — | **4–8 wk one-time** | — |

Android and desktop web (native notification action buttons, arrow-key/drag on desktop) and the
chat-unfurl spectator-page door need **no native shell at all** — they're already reachable from
the existing web app and are correctly scoped as SW7-T1/SW7-T2 (MVP/V1, per the §03 table) with
no wrapper dependency. The entire cost table above is the *iOS-native-only* tax.

## 7. Go/no-go recommendation

**No-go for V1.** Every row in §6 beyond "the shell itself" assumes a native iOS (and
occasionally watchOS) build already exists, and the one-time cost of standing that up (Xcode
project, Apple Developer enrollment, App Store review process, a release pipeline distinct from
the web app's) dwarfs any single surface's own estimate. None of it is reachable from Safari web
push — iOS's action-suppression (§1) is a hard platform wall, not a workaround-able limitation —
so there is no cheap partial win available by staying web-only.

**Recommended sequencing if greenlit later:** stand up the native shell (Capacitor, per §5)
justified by iOS notification actions alone (§1, cheapest, highest-frequency surface, and the
one where a literal notification swipe is impossible anyway per the mock's own honest framing)
before committing to the widget or Live Activity investment. Treat §2 and §4b as a bundled
second phase (both cheap once the shell exists), and §3 as a distinct, larger third phase that
should be justified on its own merits (it is the most expensive and the least "a pick surface" —
it's a spectator/reveal-moment surface, arguably valuable independent of whether picking-from-
lock-screen ever ships).

**Proposed task list for a future plan revision** (not scheduled in the current SW0–SW8 DAG):

1. **Native-shell spike** — Capacitor project wrapping the existing web app, TestFlight-only, no
   store submission; prove the WebView shell round-trips auth/session correctly.
2. **iOS notification actions** — `UNNotificationCategory` registration + a notification service
   extension that POSTs to the existing `/api/v1/picks` endpoint on action tap, reusing the
   apps/web/public/sw.js `push` payload shape already defined for web push (SW7-T1) so the
   payload contract doesn't fork between web and native.
3. **Watch notification actions** — verify the iOS category above surfaces on a paired watch
   with no extra work (per §4); add a watch app target only if it doesn't.
4. **Interactive widget** — `@capgo/capacitor-widget-kit`, SVG-templated tap wells, calling the
   same pick endpoint via an `AppIntent`.
5. **Live Activity** — full-native SwiftUI widget extension + ActivityKit push-token storage
   (new table) + a worker job firing start/reveal pushes alongside the existing `reveal:fire`
   job; budget-aware update cadence per §3's constraint.
