/**
 * Stack feed API schema (journeys plan §4/§5 WS18-T1): `GET /api/v1/stack`.
 * The single mixed deck dealt on `/` (D-J2): today's daily headliner first, then open
 * `kind='topic'` questions in the viewer's followed categories (ghost/no-follows default = all
 * categories), capped 8, soonest-close first.
 */
import { z } from 'zod';
import { questionPublicSchema } from './questions.js';

/**
 * A stack card = a `QuestionPublic` plus, on questions the viewer's active nemesis has also
 * picked (and that pick is sealed pre-lock), a `rival_sealed` flag driving the headliner's
 * `⚔ {handle} IS IN · SEALED` chip (WS18-T3). `.nullish()` per the journeys plan's additive-only
 * rule — WS18-T1 populates it; consumers built before then still validate. Extending here rather
 * than on `questionPublicSchema` keeps the flag scoped to the stack feed (it is meaningless on
 * `/questions/today` and friends) and off the ISR-cached public question shape.
 */
export const stackQuestionSchema = questionPublicSchema.extend({
  rival_sealed: z.boolean().nullish(),
});

export type StackQuestion = z.infer<typeof stackQuestionSchema>;

export const stackFeedSchema = z.object({
  /** Today's daily question, or null if none is open (e.g. before the morning drop). */
  headliner: stackQuestionSchema.nullable(),
  /** Open topic-market cards, soonest-close first, capped 8. Empty when `topic_markets` is off. */
  topics: z.array(stackQuestionSchema),
});

export type StackFeed = z.infer<typeof stackFeedSchema>;

// --- GET /api/v1/stack ------------------------------------------------------------------------

export const getStackRequestSchema = z.object({});
export const getStackResponseSchema = stackFeedSchema;
