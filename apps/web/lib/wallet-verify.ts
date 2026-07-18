/**
 * SIWE signature verification (design doc §12.2 step 3): viem's `publicClient.verifyMessage`,
 * which is compatible with plain EOA signatures AND EIP-1271/6492 smart-contract-wallet
 * signatures (verified against `POLYGON_RPC_URL`) natively — no separate code path needed for
 * either kind of wallet. Fails CLOSED: any error (bad signature, unreachable RPC, malformed
 * input) resolves to `false`, never throws past this boundary — the caller maps a `false` to
 * `SIGNATURE_INVALID`, never a 500.
 */
import { createPublicClient, http, type Address } from 'viem';
import { polygon } from 'viem/chains';

function polygonRpcUrl(): string {
  const url = process.env.POLYGON_RPC_URL;
  if (!url) throw new Error('POLYGON_RPC_URL is not set (see .env.example)');
  return url;
}

let cachedClient: ReturnType<typeof createPublicClient> | undefined;

function getPolygonClient(): ReturnType<typeof createPublicClient> {
  cachedClient ??= createPublicClient({ chain: polygon, transport: http(polygonRpcUrl()) });
  return cachedClient;
}

export interface VerifySiweSignatureInput {
  address: Address;
  message: string;
  signature: `0x${string}`;
}

/**
 * Verifies `signature` over `message` was produced by `address` — EOA (ecrecover) or smart
 * contract wallet (EIP-1271, including the ERC-6492 counterfactual/pre-deploy wrapper) alike.
 */
export async function verifySiweSignature(input: VerifySiweSignatureInput): Promise<boolean> {
  try {
    return await getPolygonClient().verifyMessage({
      address: input.address,
      message: input.message,
      signature: input.signature,
    });
  } catch {
    return false;
  }
}
