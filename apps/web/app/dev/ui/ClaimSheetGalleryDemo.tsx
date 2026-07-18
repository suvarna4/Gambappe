'use client';

/**
 * Gallery demo for `ClaimSheet` (WS7-T1 AC: "gallery renders all states"). Starts closed — this
 * page also mounts a live `ClaimPromptEngine` (whose fixed-position nudge banner sits elsewhere
 * on screen), and a permanently-open full-viewport `ClaimSheet` backdrop would otherwise
 * intercept pointer events meant for it. Click "Open claim sheet" to see the sign-in step (fetches
 * `GET /api/v1/me` on mount; in dev with no session/ghost cookie that 401s straight to sign-in).
 */
import { useState } from 'react';
import ClaimSheet from '@/components/claim/ClaimSheet';

export default function ClaimSheetGalleryDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-side-a rounded px-4 py-2 text-sm font-semibold text-white"
      >
        Open claim sheet
      </button>
      <ClaimSheet open={open} onOpenChange={setOpen} enabledProviders={['google', 'email', 'x']} />
    </>
  );
}
