import type { LobbyPlayback } from "@/shared/lobby";

/** differences below this are inaudible and not worth a seek */
export const DRIFT_IGNORE_MS = 400;
/** above this we jump straight in (big jumps would sound terrible anyway) */
export const DRIFT_HARD_SEEK_MS = 2_000;

export interface LocalPlaybackSnapshot {
  trackId: string | null;
  positionMs: number;
  status: "idle" | "loading" | "playing" | "paused" | "error";
}

export type LobbySyncMode = "none" | "soft" | "hard";

export interface LobbySyncPlan {
  /** a different track has to be loaded first */
  switchTrack: boolean;
  /** target position inside that track */
  seekTo: number | null;
  mode: LobbySyncMode;
  play: boolean;
  pause: boolean;
}

/**
 * Where the host is *right now*, extrapolated from the snapshot the server
 * relayed a moment ago.
 */
export function expectedPositionMs(
  playback: Pick<LobbyPlayback, "positionMs" | "status" | "sentAt">,
  serverNowMs: number,
): number {
  const base = Math.max(0, playback.positionMs);
  if (playback.status !== "playing") return base;
  const elapsed = Math.max(0, serverNowMs - playback.sentAt);
  return base + elapsed;
}

/**
 * Decide what the listener has to do so its own player matches the host.
 * Pure so it can be unit-tested without any audio.
 */
export function planLobbySync(
  local: LocalPlaybackSnapshot,
  remote: LobbyPlayback,
  serverNowMs: number,
): LobbySyncPlan {
  const plan: LobbySyncPlan = {
    switchTrack: false,
    seekTo: null,
    mode: "none",
    play: false,
    pause: false,
  };

  if (!remote.track) {
    // nothing playing on the host: the listener stays quiet
    if (local.status === "playing" || local.status === "loading") plan.pause = true;
    return plan;
  }

  const target = Math.round(expectedPositionMs(remote, serverNowMs));

  if (local.trackId !== remote.track.id) {
    plan.switchTrack = true;
    plan.seekTo = target;
    plan.mode = "hard";
    plan.play = remote.status === "playing";
    plan.pause = remote.status !== "playing";
    return plan;
  }

  if (remote.status === "playing") {
    if (local.status !== "playing") plan.play = true;
  } else if (local.status === "playing" || local.status === "loading") {
    plan.pause = true;
  }

  const drift = target - local.positionMs;
  const absolute = Math.abs(drift);

  if (absolute >= DRIFT_HARD_SEEK_MS) {
    plan.seekTo = target;
    plan.mode = "hard";
  } else if (absolute >= DRIFT_IGNORE_MS) {
    plan.seekTo = target;
    plan.mode = "soft";
  }

  return plan;
}

/** true when the plan actually changes something */
export function isNoopPlan(plan: LobbySyncPlan): boolean {
  return !plan.switchTrack && plan.seekTo === null && !plan.play && !plan.pause;
}
