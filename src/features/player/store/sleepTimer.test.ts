import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "./playerStore";
import { formatSleepTimerRemaining } from "../hooks/useSleepTimer";

describe("sleep timer store", () => {
  afterEach(() => {
    usePlayerStore.getState().cancelSleepTimer();
    vi.useRealTimers();
  });

  it("stores the deadline and the duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    usePlayerStore.getState().startSleepTimer(30 * 60_000);

    const state = usePlayerStore.getState();
    expect(state.sleepTimerDurationMs).toBe(30 * 60_000);
    expect(state.sleepTimerEndsAt).toBe(Date.now() + 30 * 60_000);

    state.cancelSleepTimer();
    expect(usePlayerStore.getState().sleepTimerEndsAt).toBeNull();
    expect(usePlayerStore.getState().sleepTimerDurationMs).toBeNull();
  });

  it("never arms a zero or negative timer", () => {
    usePlayerStore.getState().startSleepTimer(-5000);
    expect(usePlayerStore.getState().sleepTimerDurationMs).toBe(1000);
  });

  it("formats the remaining time as m:ss and h:mm:ss", () => {
    expect(formatSleepTimerRemaining(0)).toBe("0:00");
    expect(formatSleepTimerRemaining(65_000)).toBe("1:05");
    expect(formatSleepTimerRemaining(59 * 60_000)).toBe("59:00");
    expect(formatSleepTimerRemaining(3_725_000)).toBe("1:02:05");
  });
});
