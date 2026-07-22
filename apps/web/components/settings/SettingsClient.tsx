'use client';

/**
 * `/settings` (design doc §10.1 route table: "client | me | incl. wallet linking, deletion";
 * WS7-T9 AC: "Incl. pause nemesis, notifications, deletion (type-handle confirm)"). Wallet
 * linking/unlink is WS12-T3's "Badge + settings + unlink" scope, not this one's — no wallet
 * toggle lives here.
 *
 * Claim-gated like every other "me" surface: an unclaimed visitor (ghost or fully anonymous)
 * sees the same `ClaimEntry` used by `/claim` and claim-prompt overlays, inline, rather than a
 * bespoke "you need to claim first" screen.
 */
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { NotificationSettings, ProfileSettings, getMeResponseSchema } from '@receipts/core';
import type { AuthProviderId } from '@/lib/auth-providers';
import ClaimEntry from '@/components/claim/ClaimEntry';
import { PushOptInButton } from '@/lib/push/PushOptInButton';
import { settingsCopy } from '@/lib/copy';
import { ApiClientError, deleteMe, fetchMe, updateSettings } from '@/lib/pick-client';

type MeResponse = z.infer<typeof getMeResponseSchema>;
type Phase = 'loading' | 'not-claimed' | 'ready' | 'error';
type DeletePhase = 'idle' | 'confirming' | 'deleting' | 'done' | 'error';

export interface SettingsClientProps {
  /** `process.env.VAPID_PUBLIC_KEY`, read server-side by `page.tsx` (mirrors `PushOptInButton`'s
   * own rationale for taking this as a prop instead of fetching it). `null` when the `web_push`
   * flag is off or the key isn't configured — only `PushOptInButton` (the subscribe/unsubscribe
   * action) is gated on this; the push notification PREFERENCE toggles below render regardless,
   * since `PATCH /me/settings` isn't flag-gated and an already-subscribed profile's preferences
   * stay live either way (§4.6: "UI must render coherently with any flag off" cuts the other
   * way here — hiding a still-functional preference would be the incoherent state). */
  vapidPublicKey: string | null;
  /** Computed server-side by `page.tsx` (`getEnabledAuthProviders()`) — which sign-in options the
   * unclaimed-visitor `ClaimEntry` below should offer. */
  enabledProviders: AuthProviderId[];
}

export default function SettingsClient({ vapidPublicKey, enabledProviders }: SettingsClientProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletePhase, setDeletePhase] = useState<DeletePhase>('idle');
  const [deleteTyped, setDeleteTyped] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.claim.claimed) {
          setMe(data);
          setSettings(data.settings);
          setPhase('ready');
        } else {
          setPhase('not-claimed');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') {
          setPhase('not-claimed');
        } else {
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Both save functions below fully serialize on `saving` (a single in-flight save at a time,
  // every toggle disabled meanwhile — see the `disabled={saving}` props below) and use
  // FUNCTIONAL setState for both the optimistic write and the on-failure revert, touching only
  // the one field being changed. Serializing means at most one PATCH is ever in flight, so its
  // response always reflects the very save that's resolving — there's no window where a second,
  // concurrently-resolving request's full-object response could overwrite a still-in-flight (or
  // just-reverted) sibling field with a stale snapshot.

  async function saveNemesisPaused(next: boolean) {
    if (!settings || saving) return;
    setSaving(true);
    setSettings((cur) => (cur ? { ...cur, nemesis_paused: next } : cur));
    setSaveError(null);
    try {
      const { data } = await updateSettings({ nemesis_paused: next });
      setSettings(data.settings);
    } catch {
      setSettings((cur) => (cur ? { ...cur, nemesis_paused: !next } : cur));
      setSaveError(settingsCopy.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotification(key: keyof NotificationSettings, next: boolean) {
    if (!settings || saving) return;
    setSaving(true);
    setSettings((cur) => (cur ? { ...cur, notifications: { ...cur.notifications, [key]: next } } : cur));
    setSaveError(null);
    try {
      const { data } = await updateSettings({ notifications: { [key]: next } });
      setSettings(data.settings);
    } catch {
      setSettings((cur) =>
        cur ? { ...cur, notifications: { ...cur.notifications, [key]: !next } } : cur,
      );
      setSaveError(settingsCopy.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!me) return;
    setDeletePhase('deleting');
    try {
      await deleteMe(deleteTyped);
      setDeletePhase('done');
    } catch {
      setDeletePhase('error');
    }
  }

  if (phase === 'loading') {
    return (
      <div className="min-h-11" data-testid="settings-loading" aria-hidden="true" />
    );
  }

  if (phase === 'error') {
    return (
      <p className="text-loss text-sm" data-testid="settings-error">
        {settingsCopy.loadError}
      </p>
    );
  }

  if (phase === 'not-claimed') {
    return (
      <div className="space-y-4" data-testid="settings-not-claimed">
        <p className="text-muted text-sm">{settingsCopy.claimRequiredNotice}</p>
        <ClaimEntry presentation="inline" enabledProviders={enabledProviders} />
      </div>
    );
  }

  // phase === 'ready'
  const s = settings!;
  const profile = me!;

  if (deletePhase === 'done') {
    return (
      <div className="space-y-2" data-testid="settings-delete-done">
        <h2 className="text-lg font-bold">{settingsCopy.deleteDoneHeading}</h2>
        <p className="text-muted text-sm">{settingsCopy.deleteDoneBody}</p>
        <a href="/" className="text-side-a text-sm underline">
          {settingsCopy.deleteDoneHomeLink}
        </a>
      </div>
    );
  }

  const deleteConfirmed = deleteTyped === profile.profile.handle;

  return (
    <div className="space-y-8" data-testid="settings-ready">
      <section className="space-y-3">
        <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
          {settingsCopy.nemesisHeading}
        </h2>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            {settingsCopy.nemesisPausedLabel}
            <span className="text-muted block text-xs">{settingsCopy.nemesisPausedHint}</span>
          </span>
          <input
            type="checkbox"
            data-testid="settings-nemesis-paused"
            checked={s.nemesis_paused}
            disabled={saving}
            onChange={(e) => saveNemesisPaused(e.target.checked)}
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
          {settingsCopy.notificationsHeading}
        </h2>
        <NotificationToggle
          label={settingsCopy.emailRevealLabel}
          testId="settings-email-reveal"
          checked={s.notifications.email_reveal}
          disabled={saving}
          onChange={(next) => saveNotification('email_reveal', next)}
        />
        <NotificationToggle
          label={settingsCopy.emailNemesisLabel}
          testId="settings-email-nemesis"
          checked={s.notifications.email_nemesis}
          disabled={saving}
          onChange={(next) => saveNotification('email_nemesis', next)}
        />
        <NotificationToggle
          label={settingsCopy.emailDuoLabel}
          testId="settings-email-duo"
          checked={s.notifications.email_duo}
          disabled={saving}
          onChange={(next) => saveNotification('email_duo', next)}
        />
        <NotificationToggle
          label={settingsCopy.emailProductLabel}
          testId="settings-email-product"
          checked={s.notifications.email_product}
          disabled={saving}
          onChange={(next) => saveNotification('email_product', next)}
        />
        {/* Unlike `PushOptInButton` below, these three stay unconditional: `PATCH
            /me/settings` isn't flag-gated and the worker's push-dispatch pass reads them
            regardless of `web_push`, so hiding them behind the flag would strand anyone
            already subscribed (a different device, or subscribed before the flag flipped
            off) with no in-product way to see or change their push preferences. */}
        <NotificationToggle
          label={settingsCopy.pushRevealLabel}
          testId="settings-push-reveal"
          checked={s.notifications.push_reveal}
          disabled={saving}
          onChange={(next) => saveNotification('push_reveal', next)}
        />
        <NotificationToggle
          label={settingsCopy.pushNemesisLabel}
          testId="settings-push-nemesis"
          checked={s.notifications.push_nemesis}
          disabled={saving}
          onChange={(next) => saveNotification('push_nemesis', next)}
        />
        <NotificationToggle
          label={settingsCopy.pushDuoLabel}
          testId="settings-push-duo"
          checked={s.notifications.push_duo}
          disabled={saving}
          onChange={(next) => saveNotification('push_duo', next)}
        />
        {vapidPublicKey ? <PushOptInButton vapidPublicKey={vapidPublicKey} /> : null}
        {saveError ? (
          <p className="text-loss text-xs" role="alert" data-testid="settings-save-error">
            {saveError}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-loss text-xs font-semibold tracking-wide uppercase">
          {settingsCopy.deleteHeading}
        </h2>
        <p className="text-muted text-sm">{settingsCopy.deleteWarning}</p>
        {deletePhase === 'idle' ? (
          <button
            type="button"
            data-testid="settings-delete-open"
            className="text-loss rounded border border-current px-4 py-2 text-sm font-semibold"
            onClick={() => setDeletePhase('confirming')}
          >
            {settingsCopy.deleteButton}
          </button>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm">
              {settingsCopy.deleteConfirmPrompt(profile.profile.handle)}
              <input
                type="text"
                data-testid="settings-delete-confirm-input"
                value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)}
                className="bg-surface mt-1 block w-full rounded px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              data-testid="settings-delete-confirm-button"
              disabled={!deleteConfirmed || deletePhase === 'deleting'}
              onClick={confirmDelete}
              className="bg-loss rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {settingsCopy.deleteConfirmButton}
            </button>
            {deletePhase === 'error' ? (
              <p className="text-loss text-xs" role="alert" data-testid="settings-delete-error">
                {settingsCopy.deleteError}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function NotificationToggle({
  label,
  testId,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  testId: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      {label}
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
