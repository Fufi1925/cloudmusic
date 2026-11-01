import { describe, expect, it } from "vitest";
import {
  PowTimeoutError,
  isPowChallenge,
  leadingZeroBits,
  solvePowChallenge,
  type PowChallenge,
} from "./proofOfWork";

function challenge(overrides: Partial<PowChallenge> = {}): PowChallenge {
  // base64url("saltsalt")
  return {
    mode: "required",
    algorithm: "argon2id-v1",
    token: "tok-123",
    salt: "c2FsdHNhbHQ",
    difficulty: 4,
    memoryKiB: 8,
    iterations: 1,
    parallelism: 1,
    hashLength: 32,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    ...overrides,
  };
}

describe("proof of work", () => {
  it("counts leading zero bits", () => {
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x0f]))).toBe(12);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x80]))).toBe(16);
  });

  it("recognises a challenge payload", () => {
    expect(isPowChallenge(challenge())).toBe(true);
    expect(isPowChallenge({})).toBe(false);
    expect(isPowChallenge(null)).toBe(false);
    expect(isPowChallenge({ ...challenge(), salt: undefined })).toBe(false);
  });

  it("solves a challenge and the nonce really meets the difficulty", async () => {
    const c = challenge({ difficulty: 6 });
    const solution = await solvePowChallenge(c);
    expect(solution.token).toBe("tok-123");
    expect(Number(solution.nonce)).toBeGreaterThanOrEqual(0);

    // recompute the hash of the returned nonce independently
    const { argon2id } = await import("hash-wasm");
    const hash = await argon2id({
      password: `${c.token}:${solution.nonce}`,
      salt: new Uint8Array([0x73, 0x61, 0x6c, 0x74, 0x73, 0x61, 0x6c, 0x74]),
      parallelism: c.parallelism,
      iterations: c.iterations,
      memorySize: c.memoryKiB,
      hashLength: c.hashLength,
      outputType: "binary",
    });
    expect(leadingZeroBits(hash)).toBeGreaterThanOrEqual(c.difficulty);
  });

  it("gives up once the challenge expired", async () => {
    const expired = challenge({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await expect(solvePowChallenge(expired)).rejects.toBeInstanceOf(PowTimeoutError);
  });
});
