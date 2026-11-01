import {
  PowTimeoutError,
  solvePowChallenge,
  type PowChallenge,
} from "./proofOfWork";

// hashing runs off the main thread so the login form stays responsive while the
// nonce is being searched
self.onmessage = async (event: MessageEvent<PowChallenge>) => {
  try {
    const solution = await solvePowChallenge(event.data);
    self.postMessage({ ok: true, solution });
  } catch (error) {
    self.postMessage({
      ok: false,
      timeout: error instanceof PowTimeoutError,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
