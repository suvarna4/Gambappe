/**
 * The six §10.5 OG templates: `question`, `result` (incl. the `voided` state variant),
 * `receipt`, `matchup`, `profile`, `duo`. Pure — data in, JSX out — so each is independently
 * snapshot-testable without satori/`ImageResponse` in the loop.
 */
import type { ReactElement } from 'react';
import { colors, impliedCents } from '@receipts/ui';
import type { DuoWithProfiles, PairingWithProfiles } from '@receipts/db';
import {
  OgBarcodeFooter,
  OgCanvas,
  OgCrowdBar,
  OgHandleRow,
  OgHeadline,
  OgPriceTag,
  OgRow,
  OgStamp,
  OgStreakFlame,
  OgTicket,
  type OgStampVariant,
} from './components';
import type { ProfileOgData, QuestionOgData, ReceiptOgData } from './entities';

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://receipts.example';

function crowdPct(yesCount: number | null, noCount: number | null): number {
  const yes = yesCount ?? 0;
  const no = noCount ?? 0;
  const total = yes + no;
  return total === 0 ? 50 : Math.round((yes / total) * 100);
}

/** `question` (pre-lock) / `result` (revealed) / voided — one entity, three renders (§10.5). */
export function renderQuestionTemplate({ question, yesPrice, variant }: QuestionOgData): ReactElement {
  const path = `/q/${question.slug}`;

  if (variant === 'question') {
    return (
      <OgCanvas>
        <OgHeadline>{question.headline}</OgHeadline>
        <OgRow style={{ flexDirection: 'column', gap: 20 }}>
          {yesPrice != null && <OgPriceTag side="yes" cents={Math.round(yesPrice * 100)} />}
          <div style={{ display: 'flex', fontSize: 24, color: colors.muted }}>
            Pick your side — {question.yesLabel} / {question.noLabel}
          </div>
        </OgRow>
        <OgBarcodeFooter path={`${APP_URL()}${path}`} />
      </OgCanvas>
    );
  }

  if (variant === 'voided') {
    return (
      <OgCanvas>
        <OgHeadline>{question.headline}</OgHeadline>
        <OgRow style={{ flexDirection: 'column', gap: 20 }}>
          <OgStamp variant="void" />
          <div style={{ display: 'flex', fontSize: 22, color: colors.muted }}>
            Voided by venue — streak-safe.
          </div>
        </OgRow>
        <OgBarcodeFooter path={`${APP_URL()}${path}`} />
      </OgCanvas>
    );
  }

  // 'result'
  const pct = crowdPct(question.crowdYesAtLock, question.crowdNoAtLock);
  const outcomeLabel = question.outcome === 'yes' ? question.yesLabel : question.noLabel;
  return (
    <OgCanvas>
      <OgHeadline>{question.headline}</OgHeadline>
      <OgRow style={{ flexDirection: 'column', gap: 20 }}>
        <OgStamp variant={question.outcome ? 'win' : 'void'} />
        <div style={{ display: 'flex', fontSize: 26, color: colors.paper }}>
          The crowd said {question.outcome === 'yes' ? pct : 100 - pct}% — outcome: {outcomeLabel}
        </div>
        <OgCrowdBar yesPct={pct} />
      </OgRow>
      <OgBarcodeFooter path={`${APP_URL()}${path}`} />
    </OgCanvas>
  );
}

const RECEIPT_STAMP: Record<ReceiptOgData['variant'], OgStampVariant> = {
  win: 'win',
  loss: 'loss',
  void: 'void',
  busted_streak: 'loss',
};

/** `receipt`: a user's pick — side, entry price, result, streak, handle (§10.5). Loss +
 * busted-streak variants get equal visual treatment (P3, §10.5). */
export function renderReceiptTemplate({ pick, question, profile, variant }: ReceiptOgData): ReactElement {
  const cents = impliedCents(pick.side, pick.yesPriceAtEntry);
  return (
    <OgCanvas>
      <OgHeadline>{question.headline}</OgHeadline>
      <OgTicket style={{ gap: 16 }}>
        <OgRow style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <OgPriceTag side={pick.side} cents={cents} />
          <OgStamp variant={RECEIPT_STAMP[variant]} />
        </OgRow>
        {variant === 'busted_streak' && (
          <div style={{ display: 'flex', fontSize: 22, color: colors.loss }}>
            RIP {profile.bestStreak}-day streak
          </div>
        )}
        <OgRow style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <OgHandleRow handle={profile.handle} />
          <OgStreakFlame count={profile.currentStreak} />
        </OgRow>
      </OgTicket>
      <OgBarcodeFooter path={`${APP_URL()}/q/${question.slug}`} />
    </OgCanvas>
  );
}

/** `matchup`: nemesis scoreboard (§10.5). */
export function renderMatchupTemplate({ pairing, profileA, profileB }: PairingWithProfiles): ReactElement {
  return (
    <OgCanvas>
      <OgHeadline>Nemesis matchup</OgHeadline>
      <OgTicket style={{ gap: 20 }}>
        <OgRow style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <OgHandleRow handle={profileA.handle} />
            <div style={{ display: 'flex', fontSize: 48, fontWeight: 700, color: colors.sideA }}>
              {pairing.scoreA}
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 32, color: colors.muted }}>vs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <OgHandleRow handle={profileB.handle} />
            <div style={{ display: 'flex', fontSize: 48, fontWeight: 700, color: colors.sideB }}>
              {pairing.scoreB}
            </div>
          </div>
        </OgRow>
      </OgTicket>
      <OgBarcodeFooter path={`${APP_URL()}/vs/${pairing.id}`} />
    </OgCanvas>
  );
}

/** `profile`: record summary (§10.5). */
export function renderProfileTemplate({ profile, record }: ProfileOgData): ReactElement {
  return (
    <OgCanvas>
      <OgHeadline>{profile.handle}</OgHeadline>
      <OgTicket style={{ gap: 20 }}>
        <OgRow style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', fontSize: 20, color: colors.muted }}>Record</div>
            <div style={{ display: 'flex', fontSize: 36, fontWeight: 700 }}>
              {record.wins}-{record.losses}
              {record.voids > 0 ? `-${record.voids}` : ''}
            </div>
          </div>
          <OgStreakFlame count={profile.currentStreak} />
        </OgRow>
      </OgTicket>
      <OgBarcodeFooter path={`${APP_URL()}/p/${profile.slug}`} />
    </OgCanvas>
  );
}

/** `duo`: partners + tier + rating (§10.5). */
export function renderDuoTemplate({ duo, profileA, profileB }: DuoWithProfiles): ReactElement {
  return (
    <OgCanvas>
      <OgHeadline>
        {profileA.handle} &amp; {profileB.handle}
      </OgHeadline>
      <OgTicket style={{ gap: 16 }}>
        <OgRow style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 22, color: colors.muted }}>Tier {duo.tier}</div>
          <div style={{ display: 'flex', fontSize: 22, color: colors.muted }}>
            {duo.matchesPlayed} matches
          </div>
        </OgRow>
        <div style={{ display: 'flex', fontSize: 36, fontWeight: 700 }}>
          {Math.round(duo.glickoRating)} rating
        </div>
      </OgTicket>
      <OgBarcodeFooter path={`${APP_URL()}/duos/${duo.id}`} />
    </OgCanvas>
  );
}
