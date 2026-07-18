import { createHmac, randomBytes, createHash } from "node:crypto";

function secret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function hmacSign(value: string, secretEnvVar: string): string {
  return createHmac("sha256", secret(secretEnvVar)).update(value).digest("hex");
}

export function hmacVerify(value: string, signature: string, secretEnvVar: string): boolean {
  const expected = hmacSign(value, secretEnvVar);
  if (expected.length !== signature.length) return false;
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
