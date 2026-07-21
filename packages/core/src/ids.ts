/**
 * Branded ID types (design doc §4.2). IDs are uuidv7 strings generated app-side (§4.3);
 * branding prevents cross-entity ID mixups at compile time.
 */
import { z } from 'zod';

export type Branded<T, B extends string> = T & { readonly __brand: B };

export type ProfileId = Branded<string, 'ProfileId'>;
export type UserId = Branded<string, 'UserId'>;
export type MarketId = Branded<string, 'MarketId'>;
export type QuestionId = Branded<string, 'QuestionId'>;
export type PickId = Branded<string, 'PickId'>;
export type SeasonId = Branded<string, 'SeasonId'>;
export type PairingId = Branded<string, 'PairingId'>;
export type RematchRequestId = Branded<string, 'RematchRequestId'>;
export type DuoId = Branded<string, 'DuoId'>;
export type DuoQueueEntryId = Branded<string, 'DuoQueueEntryId'>;
export type DuoMatchId = Branded<string, 'DuoMatchId'>;
export type PlacementItemId = Branded<string, 'PlacementItemId'>;
export type PostId = Branded<string, 'PostId'>;
export type ReactionId = Branded<string, 'ReactionId'>;
export type ReportId = Branded<string, 'ReportId'>;
export type WalletLinkId = Branded<string, 'WalletLinkId'>;
export type NotificationId = Branded<string, 'NotificationId'>;
export type PushSubscriptionId = Branded<string, 'PushSubscriptionId'>;
export type CalloutId = Branded<string, 'CalloutId'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** zod schema for a branded uuid id. */
export function zId<T extends string>(): z.ZodType<Branded<string, T>> {
  return z.custom<Branded<string, T>>((v) => isUuid(v), { message: 'Invalid uuid' });
}

export const zProfileId = zId<'ProfileId'>();
export const zUserId = zId<'UserId'>();
export const zMarketId = zId<'MarketId'>();
export const zQuestionId = zId<'QuestionId'>();
export const zPickId = zId<'PickId'>();
export const zSeasonId = zId<'SeasonId'>();
export const zPairingId = zId<'PairingId'>();
export const zRematchRequestId = zId<'RematchRequestId'>();
export const zDuoId = zId<'DuoId'>();
export const zDuoQueueEntryId = zId<'DuoQueueEntryId'>();
export const zDuoMatchId = zId<'DuoMatchId'>();
export const zPlacementItemId = zId<'PlacementItemId'>();
export const zPostId = zId<'PostId'>();
export const zReactionId = zId<'ReactionId'>();
export const zReportId = zId<'ReportId'>();
export const zWalletLinkId = zId<'WalletLinkId'>();
export const zNotificationId = zId<'NotificationId'>();
export const zPushSubscriptionId = zId<'PushSubscriptionId'>();
export const zCalloutId = zId<'CalloutId'>();
