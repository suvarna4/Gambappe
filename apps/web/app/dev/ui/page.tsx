import {
  BallotCard,
  Barcode,
  CountdownTicker,
  CrowdBar,
  PriceTag,
  Stamp,
  StreakFlame,
  TicketCard,
  UnderCard,
} from '@receipts/ui';
import { ObituaryCard } from '@/components/ObituaryCard';
import { GraveyardShelf } from '@/components/GraveyardShelf';
import { NemesisFlip } from '@/components/nemesis/NemesisFlip';
import { ReactionStamps } from '@/components/nemesis/ReactionStamps';
import { VerdictCard } from '@/components/nemesis/VerdictCard';
import { DuoTandem } from '@/components/duo/DuoTandem';
import ClaimPromptEngine from '@/components/claim/ClaimPromptEngine';
import ClaimSheetGalleryDemo from './ClaimSheetGalleryDemo';
import ShareSheetGalleryDemo from './ShareSheetGalleryDemo';
import SwipeBallotGalleryDemo from './SwipeBallotGalleryDemo';

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

      {/* SW0-T2: the display face (Barlow Condensed via next/font) + the gold ritual accent.
          The headline should render condensed; the numerals stay mono; gold-on-ink passes AA. */}
      <section data-testid="gallery-display-type" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">
          Display type &amp; gold accent
        </h2>
        <div className="bg-bg space-y-2 rounded-md p-4">
          <p className="font-display text-4xl font-bold uppercase leading-none">
            Does the Fed cut rates in September?
          </p>
          <p className="font-mono text-gold text-sm">CUTS @ 71¢ · LOCKS 12:00 ET</p>
          <span className="border-gold text-gold inline-block -rotate-6 rounded border-2 px-3 py-1 font-display text-lg font-bold uppercase">
            Called it
          </span>
        </div>
      </section>

      {/* SW1-T1: the swipe ballot's card face + the under-card that peeks in the deck. Shown
          on the dark stage ground the deck (SW2-T1) will place it against. */}
      <section data-testid="gallery-ballotcard" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">BallotCard</h2>
        <div className="bg-bg relative rounded-md p-6">
          <div className="mx-auto max-w-[260px]">
            <UnderCard
              label="TOMORROW · opens 9:00 ET"
              className="absolute inset-x-6 top-8 scale-95"
            />
            <BallotCard
              eyebrow="ECON · DAILY"
              serial="№ 212"
              headline="Does the Fed cut rates in September?"
              yesLabel="CUTS"
              noLabel="HOLDS"
              yesProbability={0.71}
              venue="KALSHI · LIVE"
              lockLabel="LOCKS 12:00 ET"
            />
          </div>
        </div>
      </section>

      {/* SW1-T2: the interactive swipe ballot — drag the card, or use the wells/arrow keys. */}
      <section data-testid="gallery-swipeballot" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">SwipeBallot (interactive)</h2>
        <SwipeBallotGalleryDemo />
      </section>

      {/* SW4-T1: the busted-streak obituary — the loser's artifact (P3). Static (share/OG) form. */}
      <section data-testid="gallery-obituary" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">ObituaryCard (P3)</h2>
        <div className="bg-bg rounded-md p-6">
          <div className="mx-auto max-w-[280px]">
            <ObituaryCard
              days={11}
              startLabel="Jul 08"
              endLabel="Jul 19"
              facts={[
                { text: '3 longshots called' },
                { text: '1 freeze spent' },
                { text: 'the jobs report' },
              ]}
              sideLabel="HOLDS"
              entryCents={29}
            />
          </div>
        </div>
      </section>

      {/* SW5-T1/T3: the "same throw, now personal" receipt sections (on the deck ground). */}
      <section data-testid="gallery-matchup-flips" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">
          Nemesis flip · Duo tandem (SP2)
        </h2>
        <div className="bg-bg space-y-3 rounded-md p-6">
          <div className="mx-auto max-w-[300px] space-y-3">
            <NemesisFlip
              opponentHandle="Maria O."
              opponentSide="no"
              opponentSideLabel="HOLDS"
              opponentEntryCents={27}
              narration="She's fading the room again. Tonight one of you eats this."
              youWins={1}
              opponentWins={2}
              weekLabel="Week 30 · Day 2"
            />
            <DuoTandem
              viewerSideLabel="SCORES"
              viewerSide="yes"
              partnerHandle="Dre P."
              partnerSideLabel="BLANKS"
              partnerSide="no"
            />
          </div>
        </div>
      </section>

      {/* SW5-T2/T4: verdict card + rematch controls, preset reaction stamps. */}
      <section data-testid="gallery-verdict" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">Verdict + reactions (SP2)</h2>
        <div className="bg-bg space-y-3 rounded-md p-6">
          <div className="mx-auto max-w-[300px] space-y-3">
            <VerdictCard
              outcome="lost"
              opponentHandle="Maria O."
              youWins={2}
              opponentWins={3}
              edgeGap={11}
              dayResults={['loss', 'win', 'loss', 'win', 'split']}
            />
            <ReactionStamps selected="Called it" />
          </div>
        </div>
      </section>

      {/* SW4-T3: the profile graveyard — broken streaks beside the trophies (P3). */}
      <section data-testid="gallery-graveyard" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">GraveyardShelf (P3)</h2>
        <GraveyardShelf ripDays={[11, 6, 3]} calledItCount={3} />
      </section>

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

      <section data-testid="gallery-share-sheet" className="space-y-3">
        <h2 className="text-muted text-sm font-semibold uppercase">ShareSheet (WS8-T2)</h2>
        <ShareSheetGalleryDemo />
      </section>
    </main>
  );
}
