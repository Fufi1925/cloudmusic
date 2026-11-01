import { argon2id } from "hash-wasm";

// Liner's api protects sign-in and registration with a small proof of work:
// the server hands out a challenge, the client searches a nonce until the
// argon2id hash of "<token>:<nonce>" starts with `difficulty` zero bits and
// sends the nonce with the credentials.
export interface PowChallenge {
  mode: "off" | "optional" | "required";
  algorithm: string;
  token: string;
  salt: string;
  difficulty: number;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
  expiresAt: string;
  turnstile?: {
    mode: "off" | "optional" | "required";
    siteKey?: string;
    edge?: boolean;
  };
}

export interface PowSolution {
  token: string;
  nonce: string;
}

export const SUPPORTED_POW_ALGORITHM = "argon2id-v1";

// the server picks the difficulty; we allow a few extra bits in case the first
// tries need one more zero bit than announced, but never grind forever
const MAX_EXTRA_BITS = 6;
const FALLBACK_BUDGET_MS = 55_000;
const SAFETY_MARGIN_MS = 3_000;

export class PowTimeoutError extends Error {
  constructor() {
    super("The sign-in check took too long, try again.");
    this.name = "PowTimeoutError";
  }
}

function solveDeadline(expiresAt: string, startedAt: number): number {
  const remaining = Date.parse(expiresAt) - startedAt;
  const budget =
    Number.isFinite(remaining) && remaining > 0 && remaining <= 10 * 60_000
      ? remaining
      : FALLBACK_BUDGET_MS;
  return startedAt + Math.max(1_000, budget - SAFETY_MARGIN_MS);
}

/** number of leading zero bits in a byte array */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function isPowChallenge(value: unknown): value is PowChallenge {
  if (!value || typeof value !== "object") return false;
  const challenge = value as Partial<PowChallenge>;
  return (
    typeof challenge.token === "string" &&
    typeof challenge.salt === "string" &&
    typeof challenge.difficulty === "number" &&
    typeof challenge.memoryKiB === "number" &&
    typeof challenge.iterations === "number" &&
    typeof challenge.parallelism === "number" &&
    typeof challenge.hashLength === "number"
  );
}

export async function solvePowChallenge(
  challenge: PowChallenge,
  signal?: AbortSignal,
): Promise<PowSolution> {
  const salt = fromBase64Url(challenge.salt);
  const startedAt = Date.now();
  // an already expired challenge never becomes solvable: ask for a fresh one
  const expiresMs = Date.parse(challenge.expiresAt);
  if (Number.isFinite(expiresMs) && expiresMs <= startedAt) {
    throw new PowTimeoutError();
  }
  const deadline = solveDeadline(challenge.expiresAt, startedAt);
  const maxTries = 2 ** Math.min(challenge.difficulty + MAX_EXTRA_BITS, 30);
  for (let nonce = 0; nonce < maxTries; nonce += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() >= deadline) break;
    const hash = await argon2id({
      password: `${challenge.token}:${nonce}`,
      salt,
      parallelism: challenge.parallelism,
      iterations: challenge.iterations,
      memorySize: challenge.memoryKiB,
      hashLength: challenge.hashLength,
      outputType: "binary",
    });
    if (leadingZeroBits(hash) >= challenge.difficulty) {
      return { token: challenge.token, nonce: String(nonce) };
    }
  }
  throw new PowTimeoutError();
}
