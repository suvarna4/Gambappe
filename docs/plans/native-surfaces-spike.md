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

**The move:** long-press a notification to reveal two action buttons — `✕ {no_label}` on the
left, `{yes_label} ✓` on the right — and pick without unlocking past the lock screen.

**API:** `UNNotificationCategory` with two `UNNotificationAction`s, registered at app launch and
attached to the pushed `UNMutableNotificationContent.categoryIdentifier`. Tapping an action
launches the main app (in the background, unless the action is declared `.foreground`) and
delivers the tapped identifier to the app's own `UNUserNotificationCenterDelegate` via
`userNotificationCenter(_:didReceive:withCompletionHandler:)`, which fires the pick network call
itself — the OS does not make the request for you. (A `UNNotificationServiceExtension` is a
separate, optional piece that only mutates a push's content *before* it's shown — e.g. decrypting
a payload — it never receives action-tap responses, so it has no role here.)
([UserNotifications: Declaring your actionable notification types](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types))

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
the widget's timeline. This model is unchanged through iOS 26 — the Liquid Glass rendering
refresh that shipped with iOS 26 (WWDC25, Sept 2025) is cosmetic, not a change to the
interactivity contract.
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
Correction to an earlier draft of this doc: Live Activities are **not** display-only — since
iOS 17, the same `Button(intent:)`/`Toggle(isOn:intent:)` App Intents interactivity model from §2
is available inside a Live Activity's Lock Screen and expanded Dynamic-Island views, per the
same WidgetKit page cited in §2 ("Adding interactivity to widgets **and Live Activities**"). A
pick-from-the-island button is therefore technically possible, not just a tap-through.

**Honest constraint:** the mock's own framing ("display + tap only") underclaims the platform —
but the *product* reason to still treat this as tap-through in the mock holds regardless: the
mock's Live Activity frame is explicitly a **reveal-moment** surface (price + countdown, then the
stamped outcome), not a pick surface — the pick already happened earlier via §1/§2 or in-app.
Whether to spend the extra work wiring an actual pick button into the island is a product
decision for a future rev, not a platform limitation; this doc doesn't recommend it (see §7).
Apple also rate-limits ActivityKit push updates per activity ("notification budget"), so a naive
"push every price tick" design would get throttled — the reveal-moment update (one push,
`apns-priority: 10`) is well within budget, but a live ticking price throughout the evening is not
free and should be either client-side countdown math (server-offset pattern, already used
elsewhere in this app) with only start/reveal pushed remotely, or a deliberately coarse
price-refresh cadence.

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
semantics as §1. The notification-action path (§4a) needs **no watchOS app at all**: a category
registered by the iOS app mirrors to a paired watch automatically, actions and all. A
complication (§4b), by contrast, is a genuinely separate watchOS app target with its own
WidgetKit extension — a paired-but-not-installed watch gets the mirrored notification actions but
not a complication that was never built for it.

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
`@capgo/capacitor-widget-kit` wraps both WidgetKit home-screen widgets and ActivityKit Live
Activities (including interactive Live Activity buttons, per §3's correction) behind a Capacitor
plugin API, with the widget itself either SVG-templated (Capacitor owns the JSON state, no Swift
UI code) or "full-native" (a real SwiftUI widget view, Capacitor only ships state across the
bridge); the standalone `capacitor-live-activities` (ludufre) plugin covers just the Live
Activity case for teams that don't need the wider widget-kit surface.
([Capgo: capacitor-widget-kit docs](https://capgo.app/docs/plugins/widget-kit/),
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
| iOS notification actions (§1) | none beyond a native app target | 1–2 wk | Yes (iOS app target) |
| Watch notification actions (§4a) | rides on §1 | ~free | No separate watch app — mirrors automatically |
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
should be justified on its own merits — it is the most expensive row in §6, and even though it
could technically carry a pick button (§3's correction), the mock frames it as a
spectator/reveal-moment surface, arguably valuable on its own independent of whether
picking-from-the-island is ever built on top of it.

**Proposed task list for a future plan revision** (not scheduled in the current SW0–SW8 DAG):

1. **Native-shell spike** — Capacitor project wrapping the existing web app, TestFlight-only, no
   store submission; prove the WebView shell round-trips auth/session correctly.
2. **iOS notification actions** — `UNNotificationCategory` registration + a
   `UNUserNotificationCenterDelegate` action handler that POSTs to the existing
   `POST /api/v1/questions/:id/picks` endpoint on action tap, reusing the `apps/web/public/sw.js`
   `push` payload shape already defined for web push (SW7-T1) so the payload contract doesn't
   fork between web and native.
3. **Watch notification actions** — verify the iOS category above mirrors to a paired watch with
   no extra work (per §4a — expected by default); add a dedicated watch app only for §4b.
4. **Interactive widget** — `@capgo/capacitor-widget-kit`, SVG-templated tap wells, calling the
   same pick endpoint via an `AppIntent` (axis-ordered NO-left/YES-right per D-SW9).
5. **Live Activity** — full-native SwiftUI widget extension + ActivityKit push-token storage
   (new table) + a worker job firing start/reveal pushes alongside the existing `reveal:fire`
   job; budget-aware update cadence per §3's constraint.
