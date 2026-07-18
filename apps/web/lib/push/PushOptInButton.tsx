'use client';

/**
 * "Remind me at reveal" tap (design doc §13.2, WS9-T2 AC: "permission asked only post-claim on
 * explicit tap"). A self-contained component — no page wires it up yet (no profile/settings
 * page has merged as of this task), so it takes `vapidPublicKey` as a prop rather than fetching
 * it itself: whichever page renders this is a Server Component that already has
 * `process.env.VAPID_PUBLIC_KEY` available and can pass it down, so the public key never needs
 * its own client-fetchable endpoint (it's public by design, but there's no reason to add an API
 * surface for a value the render tree can just hand down as a prop).
 */
import { useState } from 'react';
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from './client';

type Status = 'idle' | 'subscribing' | 'subscribed' | 'unsupported' | 'denied' | 'error';

export interface PushOptInButtonProps {
  vapidPublicKey: string;
  /** Fires after a successful subscribe, with the payload already POSTed to the server. Lets
   * the caller (e.g. a settings page) refresh its own "push enabled" state. */
  onSubscribed?: () => void;
}

async function postSubscription(endpoint: string, keys: { p256dh: string; auth: string }, expirationTime: number | null) {
  const res = await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, keys, expirationTime }),
  });
  if (!res.ok) throw new Error(`push subscribe failed: ${res.status}`);
}

async function deleteSubscription(endpoint: string) {
  const res = await fetch('/api/v1/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error(`push unsubscribe failed: ${res.status}`);
}

export function PushOptInButton({ vapidPublicKey, onSubscribed }: PushOptInButtonProps) {
  const [status, setStatus] = useState<Status>(() => (isPushSupported() ? 'idle' : 'unsupported'));

  async function handleTap() {
    setStatus('subscribing');
    try {
      const payload = await subscribeToPush(vapidPublicKey);
      await postSubscription(payload.endpoint, payload.keys, payload.expirationTime);
      setStatus('subscribed');
      onSubscribed?.();
    } catch (err) {
      setStatus(err instanceof Error && err.message.includes('permission') ? 'denied' : 'error');
    }
  }

  async function handleDisable() {
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await deleteSubscription(endpoint);
      setStatus('idle');
    } catch {
      // Browser-level unsubscribe (if it happened) already took effect; surfacing 'error'
      // here just means the server-side row may still be live until it self-heals on the
      // next 404/410 from the push service — better than a silently-stuck "subscribed" button.
      setStatus('error');
    }
  }

  if (status === 'unsupported') return null;

  if (status === 'subscribed') {
    return (
      <button type="button" onClick={handleDisable}>
        Notifications on — turn off
      </button>
    );
  }

  return (
    <button type="button" onClick={handleTap} disabled={status === 'subscribing'}>
      {status === 'subscribing' ? 'Enabling…' : 'Remind me at reveal'}
      {status === 'denied' && ' (permission denied — check browser settings)'}
      {status === 'error' && ' (something went wrong, try again)'}
    </button>
  );
}
