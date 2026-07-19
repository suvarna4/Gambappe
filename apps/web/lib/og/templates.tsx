/**
 * The six §10.5 OG templates: `question`, `result` (incl. the `voided` state variant),
 * `receipt`, `matchup`, `profile`, `duo`. Pure — data in, JSX out — so each is independently
 * snapshot-testable without satori/`ImageResponse` in the loop.
 *
 * WS8-T2 extends every one of these with an optional `cardOptions` second argument: when
 * present, the SAME template renders at share-card dimensions (story/square) with a real QR
 * footer instead of the OG barcode footer — "same templates" per §10.5's card bullet, not a
 * forked layout. Omitting `cardOptions` (every existing OG route call site) is byte-identical
 * to pre-WS8-T2 behavior — `OgCanvas` defaults to 1200×630 and the footer defaults to the
 * decorative barcode.
 */
import type { ReactElement } from 'react';
import { colors, impliedCents, sideAxisPair } from '@receipts/ui';
import type { DuoWithProfiles, PairingWithProfiles } from '@receipts/db';
import {
  OgBarcodeFooter,
  OgCanvas,
  OgCrowdBar,
  OgHandleRow,
  OgHeadline,
  OgPriceTag,
  OgQrFooter,
  OgRow,
  OgStamp,
  OgStreakFlame,
  OgTicket,
  type OgStampVariant,
} from './components';
import type { ProfileOgData, QuestionOgData, ReceiptOgData } from './entities';
import {
  absoluteUrl,
  duoPagePath,
  matchupPagePath,
  profilePagePath,
  questionPagePath,
} from './paths';

/** WS8-T2: passed by `/api/cards/*` route handlers only — see this file's header comment. */
export interface CardRenderOptions {
  width: number;
  height: number;
  /** Pre-generated `data:image/png;base64,...` — see `lib/og/qr.ts` for why generation happens
   * outside these pure template functions. */
  qrDataUri: string;
}

function canvasDims(cardOptions?: CardRenderOptions): { width?: number; height?: number } {
  return cardOptions ? { width: cardOptions.width, height: cardOptions.height } : {};
}

function renderFooter(path: string, cardOptions?: CardRenderOptions): ReactElement {
  const fullPath = absoluteUrl(path);
  return cardOptions ? (
    <OgQrFooter path={fullPath} qrDataUri={cardOptions.qrDataUri} />
  ) : (
    <OgBarcodeFooter path={fullPath} />
  );
}

function crowdPct(yesCount: number | null, noCount: number | null): number {
  const yes = yesCount ?? 0;
  const no = noCount ?? 0;
  const total = yes + no;
  return total === 0 ? 50 : Math.round((yes / total) * 100);
}

/** `question` (pre-lock) / `result` (revealed) / voided — one entity, three renders (§10.5). */
export function renderQuestionTemplate(
  { question, yesPrice, variant }: QuestionOgData,
  cardOptions?: CardRenderOptions,
): ReactElement {
  const path = questionPagePath(question.slug);
  const dims = canvasDims(cardOptions);

  if (variant === 'question') {
    return (
      <OgCanvas {...dims}>
        <OgHeadline>{question.headline}</OgHeadline>
        <OgRow style={{ flexDirection: 'column', gap: 20 }}>
          {yesPrice != null && <OgPriceTag side="yes" cents={Math.round(yesPrice * 100)} />}
          <div style={{ display: 'flex', fontSize: 24, color: colors.muted }}>
            {/* D-SW9 (swipe plan §2.2): the side pair lists NO/against first (left). */}
            Pick your side — {sideAxisPair(question.noLabel, question.yesLabel).join(' / ')}
          </div>
        </OgRow>
        {renderFooter(path, cardOptions)}
      </OgCanvas>
    );
  }

  if (variant === 'voided') {
    return (
      <OgCanvas {...dims}>
        <OgHeadline>{question.headline}</OgHeadline>
        <OgRow style={{ flexDirection: 'column', gap: 20 }}>
          <OgStamp variant="void" />
          <div style={{ display: 'flex', fontSize: 22, color: colors.muted }}>
            Voided by venue — streak-safe.
          </div>
        </OgRow>
        {renderFooter(path, cardOptions)}
      </OgCanvas>
    );
  }

  // 'result'
  const pct = crowdPct(question.crowdYesAtLock, question.crowdNoAtLock);
  const outcomeLabel = question.outcome === 'yes' ? question.yesLabel : question.noLabel;
  return (
    <OgCanvas {...dims}>
      <OgHeadline>{question.headline}</OgHeadline>
      <OgRow style={{ flexDirection: 'column', gap: 20 }}>
        <OgStamp variant={question.outcome ? 'win' : 'void'} />
        <div style={{ display: 'flex', fontSize: 26, color: colors.paper }}>
          The crowd said {question.outcome === 'yes' ? pct : 100 - pct}% — outcome: {outcomeLabel}
        </div>
        <OgCrowdBar yesPct={pct} />
      </OgRow>
      {renderFooter(path, cardOptions)}
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
 * busted-streak variants get equal visual treatment (P3, §10.5 — WS8-T2 AC: both variants ship
 * as real card renders too, not just OG, see `test/integration/share-cards.test.ts`). */
export function renderReceiptTemplate(
  { pick, question, profile, variant }: ReceiptOgData,
  cardOptions?: CardRenderOptions,
): ReactElement {
  const cents = impliedCents(pick.side, pick.yesPriceAtEntry);
  return (
    <OgCanvas {...canvasDims(cardOptions)}>
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
      {renderFooter(questionPagePath(question.slug), cardOptions)}
    </OgCanvas>
  );
}

/** `matchup`: nemesis scoreboard (§10.5). */
export function renderMatchupTemplate(
  { pairing, profileA, profileB }: PairingWithProfiles,
  cardOptions?: CardRenderOptions,
): ReactElement {
  return (
    <OgCanvas {...canvasDims(cardOptions)}>
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
      {renderFooter(matchupPagePath(pairing.id), cardOptions)}
    </OgCanvas>
  );
}

/** `profile`: record summary (§10.5). */
export function renderProfileTemplate(
  { profile, record }: ProfileOgData,
  cardOptions?: CardRenderOptions,
): ReactElement {
  return (
    <OgCanvas {...canvasDims(cardOptions)}>
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
      {renderFooter(profilePagePath(profile.slug), cardOptions)}
    </OgCanvas>
  );
}

/** `duo`: partners + tier + rating (§10.5). */
export function renderDuoTemplate(
  { duo, profileA, profileB }: DuoWithProfiles,
  cardOptions?: CardRenderOptions,
): ReactElement {
  return (
    <OgCanvas {...canvasDims(cardOptions)}>
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
      {renderFooter(duoPagePath(duo.id), cardOptions)}
    </OgCanvas>
  );
}
