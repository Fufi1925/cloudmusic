import PowWorker from "./proofOfWork.worker?worker&inline";
import {
  PowTimeoutError,
  solvePowChallenge,
  type PowChallenge,
  type PowSolution,
} from "./proofOfWork";

type WorkerReply =
  | { ok: true; solution: PowSolution }
  | { ok: false; timeout?: boolean; message: string };

class WorkerUnavailable extends Error {}

// if a worker is created but never answers (blocked blob:, broken sandbox), we
// must not hang the sign-in forever: give up shortly after the challenge expires
function workerDeadline(challenge: PowChallenge): number {
  const expiresMs = Date.parse(challenge.expiresAt);
  const remaining = Number.isFinite(expiresMs) ? expiresMs - Date.now() : 60_000;
  return Math.min(Math.max(remaining, 5_000), 70_000);
}

function solveInWorker(challenge: PowChallenge): Promise<PowSolution> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      worker?.terminate();
    };
    try {
      worker = new PowWorker();
    } catch (error) {
      reject(new WorkerUnavailable(String(error)));
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      reject(new WorkerUnavailable("worker timed out"));
    }, workerDeadline(challenge));
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      cleanup();
      if (event.data.ok) resolve(event.data.solution);
      else
        reject(
          event.data.timeout
            ? new PowTimeoutError()
            : new Error(event.data.message),
        );
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new WorkerUnavailable(event.message || "worker failed"));
    };
    worker.postMessage(challenge);
  });
}

/** solve on a worker thread, fall back to the main thread where workers are unavailable */
export async function solvePow(challenge: PowChallenge): Promise<PowSolution> {
  try {
    return await solveInWorker(challenge);
  } catch (error) {
    if (error instanceof WorkerUnavailable) return solvePowChallenge(challenge);
    throw error;
  }
}
