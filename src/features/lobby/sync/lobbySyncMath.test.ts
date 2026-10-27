import { describe, expect, it } from "vitest";
import type { LobbyPlayback } from "@/shared/lobby";
import {
  DRIFT_HARD_SEEK_MS,
  DRIFT_IGNORE_MS,
  expectedPositionMs,
  isNoopPlan,
  planLobbySync,
} from "./lobbySyncMath";

function remote(overrides: Partial<LobbyPlayback> = {}): LobbyPlayback {
  return {
    track: {
      id: "t1",
      title: "Midnight Drive",
      artists: "Nova",
      coverUrl: "",
      durationMs: 210_000,
      playCount: 0,
    },
    queue: [],
    index: 0,
    positionMs: 30_000,
    status: "playing",
    sentAt: 1_000,
    ...overrides,
  };
}

describe("expectedPositionMs", () => {
  it("adds the elapsed server time while playing", () => {
    expect(expectedPositionMs({ positionMs: 10_000, status: "playing", sentAt: 1_000 }, 3_500)).toBe(12_500);
  });

  it("keeps the position when paused", () => {
    expect(expectedPositionMs({ positionMs: 10_000, status: "paused", sentAt: 1_000 }, 99_999)).toBe(10_000);
  });

  it("never goes below zero", () => {
    expect(expectedPositionMs({ positionMs: 0, status: "playing", sentAt: 5_000 }, 4_000)).toBe(0);
  });
});

describe("planLobbySync", () => {
  it("stops quietly when the host plays nothing", () => {
    const plan = planLobbySync(
      { trackId: "t1", positionMs: 4_000, status: "playing" },
      remote({ track: null }),
      2_000,
    );
    expect(plan.pause).toBe(true);
    expect(plan.switchTrack).toBe(false);
    expect(plan.seekTo).toBeNull();
  });

  it("switches track, seeks and keeps playing", () => {
    const plan = planLobbySync(
      { trackId: "other", positionMs: 90_000, status: "playing" },
      remote({ positionMs: 20_000, sentAt: 1_000 }),
      21_000,
    );
    expect(plan.switchTrack).toBe(true);
    expect(plan.mode).toBe("hard");
    expect(plan.seekTo).toBe(40_000);
    expect(plan.play).toBe(true);
    expect(plan.pause).toBe(false);
  });

  it("loads a paused track without starting it", () => {
    const plan = planLobbySync(
      { trackId: null, positionMs: 0, status: "idle" },
      remote({ status: "paused", positionMs: 12_000 }),
      5_000,
    );
    expect(plan.switchTrack).toBe(true);
    expect(plan.seekTo).toBe(12_000);
    expect(plan.pause).toBe(true);
    expect(plan.play).toBe(false);
  });

  it("ignores small drift", () => {
    const plan = planLobbySync(
      { trackId: "t1", positionMs: 30_700, status: "playing" },
      remote({ positionMs: 30_000, sentAt: 1_000 }),
      1_500,
    );
    expect(isNoopPlan(plan)).toBe(true);
  });

  it("pulls back gently between the two thresholds", () => {
    const local = DRIFT_IGNORE_MS + 900;
    const plan = planLobbySync(
      { trackId: "t1", positionMs: 30_000 - local, status: "playing" },
      remote({ positionMs: 30_000, sentAt: 1_000 }),
      1_000,
    );
    expect(plan.mode).toBe("soft");
    expect(plan.seekTo).toBe(30_000);
  });

  it("jumps hard when it is far behind", () => {
    const plan = planLobbySync(
      { trackId: "t1", positionMs: 0, status: "playing" },
      remote({ positionMs: 60_000, sentAt: 1_000 }),
      1_000,
    );
    expect(plan.mode).toBe("hard");
    expect(plan.seekTo).toBe(60_000);
  });

  it("resumes a paused listener", () => {
    const plan = planLobbySync(
      { trackId: "t1", positionMs: 30_000, status: "paused" },
      remote({ positionMs: 30_000, sentAt: 1_000 }),
      1_000,
    );
    expect(plan.play).toBe(true);
    expect(plan.seekTo).toBeNull();
  });

  it("pauses when the host pauses", () => {
    const plan = planLobbySync(
      { trackId: "t1", positionMs: 30_000, status: "playing" },
      remote({ positionMs: 30_000, status: "paused", sentAt: 1_000 }),
      9_000,
    );
    expect(plan.pause).toBe(true);
    expect(plan.seekTo).toBeNull();
  });

  it("does not treat a hard seek threshold as soft", () => {
    const plan = planLobbySync(
      { trackId: "t1", positionMs: 10_000, status: "playing" },
      remote({ positionMs: 10_000 + DRIFT_HARD_SEEK_MS, sentAt: 1_000 }),
      1_000,
    );
    expect(plan.mode).toBe("hard");
  });
});
