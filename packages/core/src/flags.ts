/**
 * Feature flags (design doc §4.6): server-side flags read from env `FLAG_<NAME>=true`,
 * defaults pinned here. UI must render coherently with any flag off.
 */

export const FLAG_DEFAULTS = {
  /** Confidence input on picks (PRD §12). */
  confidence_slider: false,
  /** All duo surfaces (off until V1.5). */
  duo_queue: false,
  /** Wallet linking §12 (off until V1). */
  wallet_linking: false,
  /** Web push §13.2 (off until V1). */
  web_push: false,
  /** All nemesis surfaces (off until WS5 E2E passes). */
  nemesis: false,
  /** Venue spread flavor (§7.7). */
  divergence_display: false,
  /** Kalshi WS live-price ticker flourish during reveal windows (§7.3, P1.5). REST
   * (`venue:price-tick`) is always the source of record — this is purely additive. */
  kalshi_ws_ticker: false,
  /** Everything Houses (P2). */
  houses: false,
  /** Passkey auth. */
  passkeys: false,
  /**
   * Swipe-ballot UX (swipe-ux-plan, SW workstreams). Off → today's tap-button question
   * flow renders byte-identically (INV-10); on → the full-screen swipe deck. Server
   * components read this and pass it to the client viewer strip as a prop, exactly like
   * `duo_queue` gates its surfaces. Off in all envs until the SW DAG lands and the
   * flag-off CI lane stays green.
   */
  swipe_ballot: false,
  /**
   * Topic-market stack supply (journeys plan §4, WS16-T1/WS18). Off → `GET /api/v1/stack`
   * returns `topics: []`, the admin "publish as topic" affordance is hidden, and `/` shows only
   * the daily headliner (byte-identical to today, INV-10). Shipped ON in prod via the environment
   * (`FLAG_TOPIC_MARKETS=true`) as the WS23-T2 rollout (docs/journeys-plan.md §5) — the code
   * default stays `false` so the flag-off lane keeps rendering byte-identically. This is the exact
   * env-gated treatment `duo_queue` uses (default off here, turned on per-environment via
   * `FLAG_DUO_QUEUE`): rollout is an env-var change in the deploy target, never a code default flip.
   */
  topic_markets: false,
  /**
   * Call-out challenge links + grudge book (journeys plan §4/§5 WS20-T3/T4). Off → the call-out
   * API 404s/hides and no challenge surfaces render. Shipped ON in prod via the environment
   * (`FLAG_CALLOUTS=true`) as the WS23-T2 rollout (docs/journeys-plan.md §5); code default stays
   * `false`, env-gated exactly like `duo_queue`/`topic_markets` above — rollout flips the env var
   * in the deploy target, not this default.
   */
  callouts: false,
  /**
   * Departures-board skin pilot on `/sweat` (journeys plan §5 WS24-T1, STRETCH). Off → `/sweat`
   * renders as paper receipts. Stays off; the board skin is a flagged stretch pilot only.
   */
  departures_board: false,
  /**
   * CPU nemesis rivals (docs/plans/cpu-nemesis-wbs.md, WS26). Off → no CPU-fill in
   * `nemesis:assign`, no `cpu:pick` sweep; nemesis behaves exactly as today. Env-gated like
   * `duo_queue` (`FLAG_CPU_NEMESIS=true` per environment); WS26-T7's metrics guardrail must be
   * live before any metrics-bearing environment enables it.
   */
  cpu_nemesis: false,
  /**
   * xTrace/Claude rivalry companion (docs/xtrace-hackathon-tasks.md XH-T1/T5/T6). Gates the
   * `companion:ingest` worker job and the banter route + Rivals-hub panel. Off → the ingest
   * job no-ops, the banter route 404s, and the panel never renders. Env-gated like every
   * other flag; code default stays `false`.
   */
  companion: false,
  /**
   * "Draft my callout" share-sheet assist (XH-T7). Off → the draft route 404s and the draft
   * button is not rendered (server reads the flag, passes a prop to `CalloutPanel`).
   */
  callout_draft: false,
  /**
   * Season-wrapped recap (XH-T8). Gates the `companion:season-recap` job and the `/you`
   * recap section. Off → job no-ops, section hidden.
   */
  season_wrapped: false,
} as const;

export type FlagName = keyof typeof FLAG_DEFAULTS;

export const FLAG_NAMES = Object.keys(FLAG_DEFAULTS) as FlagName[];

/** Env var name for a flag (`FLAG_DUO_QUEUE` etc.). */
export function flagEnvVar(name: FlagName): string {
  return `FLAG_${name.toUpperCase()}`;
}

/**
 * Resolve a flag: `FLAG_<NAME>=true|1` enables, `false|0` disables, unset/empty → default.
 */
export function isFlagEnabled(
  name: FlagName,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[flagEnvVar(name)];
  if (raw === undefined || raw === '') return FLAG_DEFAULTS[name];
  return raw === 'true' || raw === '1';
}
