'use client';

/**
 * The Rivals hub demo centerpiece (docs/xtrace-hackathon-tasks.md XH-T6): 1–3 lines of AI
 * rivalry banter, fetched once on mount. No polling, no retries — a failed/null/degraded
 * response renders nothing (the fail-open contract propagates all the way to the UI).
 *
 * Split into a pure presentational view (`CompanionBanterView`) and this effectful wrapper so
 * every render state (loading / lines + disclaimer / hidden) is unit-testable via
 * `renderToStaticMarkup` with an explicit `state` prop — the mount-effect fetch itself isn't
 * unit-tested (this repo has no jsdom/@testing-library; see `companion-banter-client.test.ts`
 * for the fetch→parse step's own coverage and `nemesis-components.test.tsx` for this
 * render-state testing convention).
 */
import { useEffect, useState } from 'react';
import { companionCopy } from '@/lib/copy';
import { fetchCompanionBanter } from '@/lib/companion/banter-client';

export type CompanionBanterState =
  { status: 'loading' } | { status: 'hidden' } | { status: 'ready'; lines: string[] };

export function CompanionBanterView({ state }: { state: CompanionBanterState }) {
  if (state.status === 'loading') {
    return (
      <div data-testid="companion-banter-loading" className="text-muted text-sm">
        {companionCopy.loading}
      </div>
    );
  }
  if (state.status === 'hidden') return null;

  return (
    <section data-testid="companion-banter" className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide">{companionCopy.heading}</h3>
      <ul className="space-y-1 text-sm">
        {state.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p data-testid="companion-banter-disclaimer" className="text-muted text-xs">
        {companionCopy.disclaimer}
      </p>
    </section>
  );
}

export interface CompanionBanterProps {
  pairingId: string;
}

export function CompanionBanter({ pairingId }: CompanionBanterProps) {
  const [state, setState] = useState<CompanionBanterState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void fetchCompanionBanter(pairingId).then((banter) => {
      if (cancelled) return;
      setState(banter ? { status: 'ready', lines: banter.lines } : { status: 'hidden' });
    });
    return () => {
      cancelled = true;
    };
  }, [pairingId]);

  return <CompanionBanterView state={state} />;
}
