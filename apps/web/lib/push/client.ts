/**
 * Browser-side web-push helpers (design doc §13.2, WS9-T2). Pure functions over the standard
 * `navigator.serviceWorker`/`PushManager` browser APIs — no React here so they're unit-testable
 * without a component-testing setup; `PushOptInButton.tsx` is the only caller.
 */

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** VAPID public keys are URL-safe base64 (RFC 7515 §2); `PushManager.subscribe` wants a
 * `BufferSource` `applicationServerKey`, not the raw string. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js');
}

export function applicationServerKeyMatches(existing: ArrayBuffer | null, requested: Uint8Array): boolean {
  if (!existing) return false;
  const existingBytes = new Uint8Array(existing);
  if (existingBytes.length !== requested.length) return false;
  for (let i = 0; i < existingBytes.length; i++) {
    if (existingBytes[i] !== requested[i]) return false;
  }
  return true;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
}

function subscriptionToPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error('subscriptionToPayload: incomplete PushSubscription JSON');
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    expirationTime: subscription.expirationTime,
  };
}

/**
 * The full opt-in sequence, called ONLY from an explicit user tap (§13.2 AC — never on load):
 * registers the service worker, requests Notification permission, and subscribes via
 * `PushManager`. Throws if permission is denied or the browser lacks support — the caller
 * (`PushOptInButton`) surfaces that as a UI state rather than retrying silently.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionPayload> {
  if (!isPushSupported()) throw new Error('Push notifications are not supported in this browser');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');

  const registration = await registerServiceWorker();
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();

  // A VAPID key rotation invalidates any existing subscription — the push service then rejects
  // sends with 403 (not 404/410), which `WebPushTransport` treats as a transient error, not a
  // dead endpoint, so it would never self-heal via `notify:dispatch`'s revocation path. Detect
  // the mismatch here instead and resubscribe fresh under the current key.
  if (subscription && !applicationServerKeyMatches(subscription.options?.applicationServerKey ?? null, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }

  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });

  return subscriptionToPayload(subscription);
}

/** Unsubscribes at the browser level and returns the endpoint so the caller can also revoke it
 * server-side — `PushManager.unsubscribe()` alone doesn't tell the server. Silent no-op if
 * there was never an active subscription (nothing to unsubscribe or notify). */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
