/**
 * SW8-T3 · How a pick was entered, for the `pick_created` client analytics event (swipe-ux-plan
 * §3.3 SW8-T3). This is the INPUT METHOD — deliberately distinct from `pick-source.ts`'s
 * server-derived attribution `source` (§6.2 step 1), which is a different concept (where the pick
 * came FROM, not how it was entered). Powers the PRD §10 activation readout: the share of picks
 * that came from a swipe, and the >40%-one-throw target.
 *
 * A plain client-side union — NOT a `packages/core` contract (the analytics event's `props` is a
 * free `Record`, §13.1), so adding it needs no contract-change PR.
 */
export const PICK_INPUT_SOURCES = ['swipe', 'well', 'key', 'push', 'widget'] as const;

export type PickInputSource = (typeof PICK_INPUT_SOURCES)[number];

export function isPickInputSource(value: string): value is PickInputSource {
  return (PICK_INPUT_SOURCES as readonly string[]).includes(value);
}

/** The default when a caller doesn't specify — the tap-button flow is a well. */
export const DEFAULT_PICK_SOURCE: PickInputSource = 'well';
