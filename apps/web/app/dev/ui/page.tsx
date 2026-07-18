import {
  Barcode,
  CountdownTicker,
  CrowdBar,
  PriceTag,
  Stamp,
  StreakFlame,
  TicketCard,
} from '@receipts/ui';
import ClaimPromptEngine from '@/components/claim/ClaimPromptEngine';
import ClaimSheetGalleryDemo from './ClaimSheetGalleryDemo';

/**
 * `/dev/ui` — the WS7-T1 design-system gallery (design doc §19.3 AC: "gallery renders all
 * states"). Not linked from product nav; a dev-only reference page for every token/motif.
 */
export default function UiGalleryPage() {
  const soon = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();

  return (
    <main className="mx-auto max-w-2xl space-y-12 px-6 py-10">
      <h1 className="text-2xl font-bold">Design system gallery</h1>

      <section data-testid="gallery-ticketcard" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">TicketCard</h2>
        <TicketCard>
          <p className="font-mono text-sm">Will France win the final?</p>
          <PriceTag side="yes" label="France" yesProbability={0.63} />
        </TicketCard>
      </section>

      <section data-testid="gallery-stamp" className="flex flex-wrap gap-4">
        <h2 className="text-muted w-full text-sm font-semibold uppercase">Stamp</h2>
        <Stamp variant="win" />
        <Stamp variant="loss" />
        <Stamp variant="void" />
        <Stamp variant="called_it" />
        <Stamp variant="pending" />
      </section>

      <section data-testid="gallery-pricetag" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">PriceTag</h2>
        {/* PriceTag is a "printed on paper" motif (§10.4 ink token) — always shown on a
            paper surface, same as it will be inside a TicketCard in product UI. */}
        <div className="bg-paper flex flex-wrap gap-6 rounded-md px-4 py-3">
          <PriceTag side="yes" label="France" yesProbability={0.63} />
          <PriceTag side="no" label="Brazil" yesProbability={0.63} />
          <PriceTag side="yes" label="Yes" yesProbability={0.02} />
          <PriceTag side="no" label="No" yesProbability={0.02} />
        </div>
      </section>

      <section data-testid="gallery-crowdbar" className="space-y-4">
        <h2 className="text-muted text-sm font-semibold uppercase">CrowdBar</h2>
        <CrowdBar yesCount={70} noCount={30} yesLabel="France" noLabel="Brazil" />
        <CrowdBar yesCount={99} noCount={1} yesLabel="Yes" noLabel="No" />
        <CrowdBar yesCount={0} noCount={0} yesLabel="Yes" noLabel="No" />
      </section>

      <section data-testid="gallery-countdown" className="flex flex-wrap gap-6">
        <h2 className="text-muted w-full text-sm font-semibold uppercase">CountdownTicker</h2>
        <CountdownTicker targetIso={soon} label="Locks in" />
        <CountdownTicker targetIso={past} label="Locked" />
      </section>

      <section data-testid="gallery-streakflame" className="flex flex-wrap gap-6">
        <h2 className="text-muted w-full text-sm font-semibold uppercase">StreakFlame</h2>
        <StreakFlame count={0} />
        <StreakFlame count={3} />
        <StreakFlame count={30} />
        <StreakFlame count={12} frozen />
      </section>

      <section data-testid="gallery-barcode" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">Barcode</h2>
        <Barcode path="/q/2026-07-19-world-cup-final" />
      </section>

      <section data-testid="gallery-claim-prompt-streak" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">
          ClaimPromptEngine (WS7-T5, streak trigger)
        </h2>
        <ClaimPromptEngine
          isGhost
          streakCurrent={3}
          pickCount={1}
          viewingNemesisOrDuoSurfaceAsGhost={false}
        />
      </section>

      <section data-testid="gallery-claim-sheet" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">ClaimSheet (WS7-T5)</h2>
        <ClaimSheetGalleryDemo />
      </section>
    </main>
  );
}
