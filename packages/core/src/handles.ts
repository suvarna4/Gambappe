/**
 * Handle material (design doc §6.1.2).
 *
 * - ANIMALS: the curated 120-word list for generated ghost handles (`{Animal} #{NNNN}`).
 *   Curated once at WS0: common animal words only — no slurs, no brand names, no human names.
 * - RESERVED_HANDLE_TERMS: impersonation guard for custom handles (venue names, staff-ish terms).
 * - slugifyHandle: deterministic URL slug derivation (`Fox #4821` → `fox-4821`).
 */

export const ANIMALS = [
  'Fox', 'Owl', 'Wolf', 'Bear', 'Hawk', 'Lynx', 'Otter', 'Raven', 'Crane', 'Heron',
  'Falcon', 'Badger', 'Marten', 'Stoat', 'Ermine', 'Moose', 'Elk', 'Bison', 'Ibex', 'Oryx',
  'Gazelle', 'Impala', 'Cheetah', 'Leopard', 'Panther', 'Jaguar', 'Ocelot', 'Serval', 'Caracal',
  'Cougar', 'Bobcat', 'Coyote', 'Jackal', 'Dingo', 'Fennec', 'Ferret', 'Weasel', 'Mink',
  'Beaver', 'Muskrat', 'Hedgehog', 'Pangolin', 'Armadillo', 'Sloth', 'Tapir', 'Okapi', 'Zebra',
  'Camel', 'Llama', 'Alpaca', 'Vicuna', 'Yak', 'Antelope', 'Reindeer', 'Caribou', 'Walrus',
  'Seal', 'Orca', 'Dolphin', 'Narwhal', 'Beluga', 'Manatee', 'Turtle', 'Tortoise', 'Gecko',
  'Iguana', 'Chameleon', 'Newt', 'Axolotl', 'Salamander', 'Toad', 'Puffin', 'Petrel',
  'Albatross', 'Gannet', 'Cormorant', 'Pelican', 'Ibis', 'Egret', 'Stork', 'Flamingo', 'Swan',
  'Goose', 'Teal', 'Wigeon', 'Eider', 'Plover', 'Sandpiper', 'Curlew', 'Godwit', 'Avocet',
  'Kestrel', 'Merlin', 'Osprey', 'Harrier', 'Kite', 'Buzzard', 'Condor', 'Eagle', 'Magpie',
  'Jay', 'Rook', 'Jackdaw', 'Starling', 'Thrush', 'Wren', 'Finch', 'Siskin', 'Linnet',
  'Bunting', 'Lark', 'Swift', 'Swallow', 'Nightjar', 'Cuckoo', 'Hoopoe', 'Kingfisher',
  'Woodpecker', 'Nuthatch', 'Wagtail',
] as const;

/** Custom handle shape: 3–20 chars `[a-zA-Z0-9_]` (§6.1.2). */
export const HANDLE_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Reserved terms for custom handles (§6.1.2): venue names, product name, staff-ish terms and
 * obvious variants. A custom handle containing any of these (case-insensitive, separator- and
 * leet-normalized) is rejected. The profanity denylist itself is WS2-T1 scope.
 */
export const RESERVED_HANDLE_TERMS = [
  'kalshi',
  'polymarket',
  'receipts',
  'official',
  'admin',
  'administrator',
  'mod',
  'moderator',
  'support',
  'staff',
  'system',
  'helpdesk',
] as const;

/**
 * Normalized screening candidates: lowercase, separators stripped, common leetspeak folded.
 * `1` is ambiguous (i or l) so both variants are produced.
 */
function screeningCandidates(handle: string): string[] {
  const base = handle
    .toLowerCase()
    .replace(/[_\-.\s]/g, '')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
  return [base.replace(/1/g, 'i'), base.replace(/1/g, 'l')];
}

/** True when a proposed custom handle collides with a reserved term (impersonation guard). */
export function isReservedHandle(handle: string): boolean {
  return screeningCandidates(handle).some((normalized) =>
    RESERVED_HANDLE_TERMS.some((term) => {
      // Short terms ("mod") would substring-match innocents ("modest") — exact match only.
      if (term.length <= 4) return normalized === term;
      return normalized.includes(term);
    }),
  );
}

/**
 * Deterministic URL slug from a handle (§5.2 `profiles.slug`): lowercase, alnum + `-` only.
 * `Fox #4821` → `fox-4821`.
 */
export function slugifyHandle(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
