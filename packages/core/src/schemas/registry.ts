/**
 * The complete API contract registry — one entry per §9.2 endpoint row (all 44).
 * The WS0-T2 acceptance test walks this map asserting every endpoint has request+response
 * zod schemas exported. The frontend imports these schemas; this is the web↔API contract (§9.1).
 */
import type { z } from 'zod';
import {
  getTodayQuestionRequestSchema,
  getTodayQuestionResponseSchema,
  getQuestionRequestSchema,
  getQuestionResponseSchema,
  getRevealRequestSchema,
  getRevealResponseSchema,
} from './questions.js';
import {
  createPickRequestSchema,
  createPickResponseSchema,
  deletePickRequestSchema,
  deletePickResponseSchema,
} from './picks.js';
import {
  getQuestionThreadRequestSchema,
  getQuestionThreadResponseSchema,
  getPairingThreadRequestSchema,
  getPairingThreadResponseSchema,
  getDuoMatchThreadRequestSchema,
  getDuoMatchThreadResponseSchema,
  createQuestionPostRequestSchema,
  createPairingPostRequestSchema,
  createDuoMatchPostRequestSchema,
  createPostResponseSchema,
  createReactionRequestSchema,
  createReactionResponseSchema,
} from './threads.js';
import {
  getProfileRequestSchema,
  getProfileResponseSchema,
  getProfilePicksRequestSchema,
  getProfilePicksResponseSchema,
} from './profiles.js';
import {
  getMeRequestSchema,
  getMeResponseSchema,
  updateHandleRequestSchema,
  updateHandleResponseSchema,
  deleteMeRequestSchema,
  deleteMeResponseSchema,
} from './me.js';
import { updateSettingsBodySchema, updateSettingsResponseSchema } from './settings.js';
import { claimRequestSchema, claimResponseSchema } from './claim.js';
import {
  getPlacementRequestSchema,
  getPlacementResponseSchema,
  placementAnswerRequestSchema,
  placementAnswerResponseSchema,
} from './placement.js';
import {
  getCurrentPairingRequestSchema,
  getCurrentPairingResponseSchema,
  getPairingRequestSchema,
  getPairingResponseSchema,
  getNemesisHistoryRequestSchema,
  getNemesisHistoryResponseSchema,
  createRematchRequestSchema,
  createRematchResponseSchema,
  respondRematchRequestSchema,
  respondRematchResponseSchema,
} from './pairings.js';
import {
  enqueueDuoRequestSchema,
  enqueueDuoResponseSchema,
  dequeueDuoRequestSchema,
  dequeueDuoResponseSchema,
  getCurrentDuoRequestSchema,
  getCurrentDuoResponseSchema,
  getDuoRequestSchema,
  getDuoResponseSchema,
  getLadderRequestSchema,
  getLadderResponseSchema,
  disbandDuoRequestSchema,
  disbandDuoResponseSchema,
} from './duos.js';
import {
  createBlockRequestSchema,
  createBlockResponseSchema,
  deleteBlockRequestSchema,
  deleteBlockResponseSchema,
  createReportRequestSchema,
  createReportResponseSchema,
} from './social.js';
import {
  walletNonceRequestSchema,
  walletNonceResponseSchema,
  walletVerifyRequestSchema,
  walletVerifyResponseSchema,
  walletUnlinkRequestSchema,
  walletUnlinkResponseSchema,
} from './wallet.js';
import {
  pushSubscribeRequestSchema,
  pushSubscribeResponseSchema,
  pushUnsubscribeRequestSchema,
  pushUnsubscribeResponseSchema,
} from './push.js';
import { eventIngestRequestSchema, eventIngestResponseSchema } from './events.js';
import {
  getWeeklyLeaderboardsRequestSchema,
  getWeeklyLeaderboardsResponseSchema,
} from './leaderboards.js';
import { revalidateRequestSchema, revalidateResponseSchema } from './internal.js';
import { z as zod } from 'zod';

export type EndpointAuth = 'none' | 'ghost+' | 'claimed' | 'admin' | 'internal';

export interface EndpointContract {
  auth: EndpointAuth;
  request: z.ZodTypeAny;
  response: z.ZodTypeAny;
}

const updateSettingsRequestSchema = zod.object({ body: updateSettingsBodySchema });

/** Every §9.2 endpoint (method + path template) → contract. */
export const API_CONTRACT = {
  'GET /questions/today': {
    auth: 'none',
    request: getTodayQuestionRequestSchema,
    response: getTodayQuestionResponseSchema,
  },
  'GET /questions/:slug': {
    auth: 'none',
    request: getQuestionRequestSchema,
    response: getQuestionResponseSchema,
  },
  'GET /questions/:slug/reveal': {
    auth: 'ghost+',
    request: getRevealRequestSchema,
    response: getRevealResponseSchema,
  },
  'POST /questions/:id/picks': {
    auth: 'none',
    request: createPickRequestSchema,
    response: createPickResponseSchema,
  },
  'DELETE /picks/:id': {
    auth: 'ghost+',
    request: deletePickRequestSchema,
    response: deletePickResponseSchema,
  },
  'GET /questions/:slug/thread': {
    auth: 'none',
    request: getQuestionThreadRequestSchema,
    response: getQuestionThreadResponseSchema,
  },
  'GET /pairings/:id/thread': {
    auth: 'none',
    request: getPairingThreadRequestSchema,
    response: getPairingThreadResponseSchema,
  },
  'GET /duo-matches/:id/thread': {
    auth: 'none',
    request: getDuoMatchThreadRequestSchema,
    response: getDuoMatchThreadResponseSchema,
  },
  'POST /questions/:id/posts': {
    auth: 'claimed',
    request: createQuestionPostRequestSchema,
    response: createPostResponseSchema,
  },
  'POST /pairings/:id/posts': {
    auth: 'claimed',
    request: createPairingPostRequestSchema,
    response: createPostResponseSchema,
  },
  'POST /duo-matches/:id/posts': {
    auth: 'claimed',
    request: createDuoMatchPostRequestSchema,
    response: createPostResponseSchema,
  },
  'POST /reactions': {
    auth: 'ghost+',
    request: createReactionRequestSchema,
    response: createReactionResponseSchema,
  },
  'GET /profiles/:slug': {
    auth: 'none',
    request: getProfileRequestSchema,
    response: getProfileResponseSchema,
  },
  'GET /profiles/:slug/picks': {
    auth: 'none',
    request: getProfilePicksRequestSchema,
    response: getProfilePicksResponseSchema,
  },
  'GET /me': {
    auth: 'ghost+',
    request: getMeRequestSchema,
    response: getMeResponseSchema,
  },
  'PATCH /me/settings': {
    auth: 'claimed',
    request: updateSettingsRequestSchema,
    response: updateSettingsResponseSchema,
  },
  'PATCH /me/handle': {
    auth: 'claimed',
    request: updateHandleRequestSchema,
    response: updateHandleResponseSchema,
  },
  'POST /claim': {
    auth: 'claimed',
    request: claimRequestSchema,
    response: claimResponseSchema,
  },
  'DELETE /me': {
    auth: 'claimed',
    request: deleteMeRequestSchema,
    response: deleteMeResponseSchema,
  },
  'GET /placement': {
    auth: 'ghost+',
    request: getPlacementRequestSchema,
    response: getPlacementResponseSchema,
  },
  'POST /placement/answers': {
    auth: 'ghost+',
    request: placementAnswerRequestSchema,
    response: placementAnswerResponseSchema,
  },
  'GET /pairings/current': {
    auth: 'claimed',
    request: getCurrentPairingRequestSchema,
    response: getCurrentPairingResponseSchema,
  },
  'GET /pairings/:id': {
    auth: 'none',
    request: getPairingRequestSchema,
    response: getPairingResponseSchema,
  },
  'GET /me/nemesis-history': {
    auth: 'claimed',
    request: getNemesisHistoryRequestSchema,
    response: getNemesisHistoryResponseSchema,
  },
  'POST /rematch-requests': {
    auth: 'claimed',
    request: createRematchRequestSchema,
    response: createRematchResponseSchema,
  },
  'POST /rematch-requests/:id/accept': {
    auth: 'claimed',
    request: respondRematchRequestSchema,
    response: respondRematchResponseSchema,
  },
  'POST /rematch-requests/:id/decline': {
    auth: 'claimed',
    request: respondRematchRequestSchema,
    response: respondRematchResponseSchema,
  },
  'POST /duo/queue': {
    auth: 'claimed',
    request: enqueueDuoRequestSchema,
    response: enqueueDuoResponseSchema,
  },
  'DELETE /duo/queue': {
    auth: 'claimed',
    request: dequeueDuoRequestSchema,
    response: dequeueDuoResponseSchema,
  },
  'GET /duo/current': {
    auth: 'claimed',
    request: getCurrentDuoRequestSchema,
    response: getCurrentDuoResponseSchema,
  },
  'GET /duos/:id': {
    auth: 'none',
    request: getDuoRequestSchema,
    response: getDuoResponseSchema,
  },
  'GET /duo/ladder': {
    auth: 'none',
    request: getLadderRequestSchema,
    response: getLadderResponseSchema,
  },
  'POST /duos/:id/disband': {
    auth: 'claimed',
    request: disbandDuoRequestSchema,
    response: disbandDuoResponseSchema,
  },
  'POST /blocks': {
    auth: 'claimed',
    request: createBlockRequestSchema,
    response: createBlockResponseSchema,
  },
  'DELETE /blocks/:blocked_profile_id': {
    auth: 'claimed',
    request: deleteBlockRequestSchema,
    response: deleteBlockResponseSchema,
  },
  'POST /reports': {
    auth: 'ghost+',
    request: createReportRequestSchema,
    response: createReportResponseSchema,
  },
  'POST /wallet/nonce': {
    auth: 'claimed',
    request: walletNonceRequestSchema,
    response: walletNonceResponseSchema,
  },
  'POST /wallet/verify': {
    auth: 'claimed',
    request: walletVerifyRequestSchema,
    response: walletVerifyResponseSchema,
  },
  'DELETE /wallet': {
    auth: 'claimed',
    request: walletUnlinkRequestSchema,
    response: walletUnlinkResponseSchema,
  },
  'POST /push/subscribe': {
    auth: 'claimed',
    request: pushSubscribeRequestSchema,
    response: pushSubscribeResponseSchema,
  },
  'DELETE /push/subscribe': {
    auth: 'claimed',
    request: pushUnsubscribeRequestSchema,
    response: pushUnsubscribeResponseSchema,
  },
  'POST /events': {
    auth: 'none',
    request: eventIngestRequestSchema,
    response: eventIngestResponseSchema,
  },
  'GET /leaderboards/weekly': {
    auth: 'none',
    request: getWeeklyLeaderboardsRequestSchema,
    response: getWeeklyLeaderboardsResponseSchema,
  },
  'POST /internal/revalidate': {
    auth: 'internal',
    request: revalidateRequestSchema,
    response: revalidateResponseSchema,
  },
} as const satisfies Record<string, EndpointContract>;

export type ApiEndpoint = keyof typeof API_CONTRACT;
