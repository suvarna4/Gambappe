// Web push service worker (design doc §13.2, WS9-T2; pick actions SW7-T1). Deliberately minimal:
// this app has no offline/cache strategy (spectator pages are ISR/CDN-served, §10.2) — this worker
// exists solely to receive `push` events and forward them to the OS notification tray, to route a
// notification tap back into the app, and (SW7-T1) to submit a pick straight from a notification
// action button. No `fetch` handler: registering one would opt every navigation into this worker's
// control for no benefit here, and any bug in it would risk breaking normal page loads app-wide.
// (The `fetch()` calls below are the worker's own outbound requests, not a `fetch` event handler —
// they go straight to the network.)

const ICON = '/icon-192.png';
// Kept in lockstep with apps/worker notification-push-actions.ts (a static SW can't import it).
const PICK_ACTIONS = { 'pick:yes': 'yes', 'pick:no': 'no' };

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Receipts', body: event.data.text() };
  }

  const title = payload.title || 'Receipts';
  // `data` carries the deep-link url plus (SW7-T1) the question id + labels a pick action needs.
  const data =
    payload.data && typeof payload.data === 'object'
      ? { url: payload.url || '/', ...payload.data }
      : { url: payload.url || '/' };

  const options = {
    body: payload.body || '',
    icon: payload.icon || ICON,
    badge: payload.badge || ICON,
    data,
  };

  // SW7-T1: axis-ordered pick actions ([✕ {no}] [{yes} ✓]) when the daily-open push carries them.
  // The worker already strips these for iOS-Safari endpoints, so `payload.actions` is simply
  // absent there; Chromium/Firefox render up to Notification.maxActions (≥2).
  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    options.actions = payload.actions
      .slice(0, 2)
      .map((a) => ({ action: a.action, title: a.title }));
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  // SW7-T1: a pick action button (not a body tap) → submit the pick server-side, then confirm.
  const side = PICK_ACTIONS[event.action];
  if (side) {
    event.waitUntil(handlePickAction(side, data));
    return;
  }

  // Body tap → focus an existing tab on the deep link, or open one (WS9-T2 behavior).
  const targetUrl = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil(focusOrOpen(targetUrl));
});

/**
 * SW7-T1: POST the pick with the session cookie (never a client-side price — the server stamps it,
 * §6.2). 201 → a receipt confirmation; 409 → already picked (double-tap idempotency, treated as
 * done, not an error); anything else (unauthed / first-pick age gate / offline) → a follow-up that
 * deep-links into the armed deck so the pick is finished in-app. The action tap is never a dead end.
 */
async function handlePickAction(side, data) {
  const armUrl = armLink(data.url);
  const questionId = data.questionId;
  if (!questionId) return openWindow(armUrl);

  let res;
  try {
    res = await fetch(`/api/v1/questions/${encodeURIComponent(questionId)}/picks`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side }),
    });
  } catch {
    return notifyFinishInApp(armUrl);
  }

  if (res.status === 201) {
    const body = await res.json().catch(() => null);
    return self.registration.showNotification('You’re in.', {
      icon: ICON,
      badge: ICON,
      body: receiptLine(side, data, body),
      data: { url: data.url || '/' },
    });
  }
  if (res.status === 409) {
    return self.registration.showNotification('Already called.', {
      icon: ICON,
      badge: ICON,
      body: 'You already called this one — tap to see your receipt.',
      data: { url: data.url || '/' },
    });
  }
  // 401 (no identity), AGE_ATTESTATION_REQUIRED, QUESTION_LOCKED, or any other status.
  return notifyFinishInApp(armUrl);
}

/** Append `arm=1` to the deep link (pre-armed deck, SW2-T4/SW7-T2): full rails + one nudge. */
function armLink(url) {
  const u = new URL(url || '/', self.location.origin);
  u.searchParams.set('arm', '1');
  return u.href;
}

function receiptLine(side, data, body) {
  const label = side === 'yes' ? data.yesLabel || 'YES' : data.noLabel || 'NO';
  const cents = receiptCents(side, body);
  return cents != null
    ? `${label} @ ${cents}¢ — tap to see your receipt.`
    : `${label} — tap to see your receipt.`;
}

/** Implied entry price in cents from the 201 body's stamped `yes_price_at_entry` (0–1). */
function receiptCents(side, body) {
  const yes = body && body.data && body.data.pick && body.data.pick.yes_price_at_entry;
  if (typeof yes !== 'number') return null;
  const p = side === 'yes' ? yes : 1 - yes;
  return Math.round(p * 100);
}

async function notifyFinishInApp(armUrl) {
  return self.registration.showNotification('Finish your pick', {
    icon: ICON,
    badge: ICON,
    body: 'One tap in the app to lock it in.',
    data: { url: armUrl },
  });
}

async function focusOrOpen(targetUrl) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    // client.url is absolute; targetUrl was resolved against the origin above, so compare directly.
    if (client.url === targetUrl && 'focus' in client) return client.focus();
  }
  return openWindow(targetUrl);
}

function openWindow(url) {
  if (self.clients.openWindow) return self.clients.openWindow(url);
  return undefined;
}
