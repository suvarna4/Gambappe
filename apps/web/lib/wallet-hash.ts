/**
 * `wallet_links.address_hash` (design doc §5.6, §12.5): HMAC-SHA256(lowercased address,
 * `WALLET_HASH_SECRET`), hex. Same one-pinned-scheme posture as `ghost-cookie.ts`'s secret
 * hashing — never plain SHA-256, never derived from anything but this one HMAC key. Addresses
 * are lowercased before hashing so `0xABC...` and `0xabc...` hash identically (WS12-T1 AC:
 * "address case-insensitivity").
 */
import { createHmac } from 'node:crypto';

function walletHashSecret(): string {
  const key = process.env.WALLET_HASH_SECRET;
  if (!key) throw new Error('WALLET_HASH_SECRET is not set (see .env.example)');
  return key;
}

/** Lowercases `address` before hashing — callers should also store the lowercased form. */
export function hashWalletAddress(address: string): string {
  return createHmac('sha256', walletHashSecret()).update(address.toLowerCase()).digest('hex');
}
