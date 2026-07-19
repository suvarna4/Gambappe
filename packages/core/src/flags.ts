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
