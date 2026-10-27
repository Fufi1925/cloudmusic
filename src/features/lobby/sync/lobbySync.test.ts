import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── fakes for the two things the bridge talks to ─────────────────────────
const messageListeners = new Set<(message: any) => void>();
const sent: any[] = [];

const player = {
  currentTrack: null as any,
  positionMs: 0,
  status: "idle" as string,
  queue: [] as any[],
  currentIndex: 0,
  shuffle: false,
  setShuffle: vi.fn(),
};

const playTrack = vi.fn(async (_track: any, _queue?: any[], _context?: string | null, _cover?: string | null, _index?: number, _preserve?: boolean) => undefined);
const seek = vi.fn();
const pause = vi.fn();
const resume = vi.fn();
const skipNext = vi.fn(async () => undefined);

vi.mock("@/shared/lobby", () => ({
  lobbyClient: {
    onMessage: (fn: (message: any) => void) => {
      messageListeners.add(fn);
      return () => messageListeners.delete(fn);
    },
    onState: () => () => {},
    send: (message: any) => sent.push(message),
    serverNow: () => 1_000,
    isConnected: () => true,
    onReconnect: null,
    setUrl: () => {},
    start: () => {},
    stop: () => {},
  },
  getDefaultLobbyUrl: () => "ws://test/v1/lobby/ws",
  normalizeLobbyUrl: (url: string) => url,
  storeLobbyUrl: () => {},
}));

vi.mock("@/features/player", () => ({
  playerEngine: { playTrack, seek, pause, resume, skipNext },
  usePlayerStore: {
    getState: () => player,
    subscribe: () => () => {},
  },
}));

const { startLobbySync, stopLobbySync } = await import("./lobbySync");
const { useLobbyStore } = await import("../store/lobbyStore");

function track(id: string, title = id) {
  return { id, title, artists: "Artist", coverUrl: "", durationMs: 200_000, playCount: 0 };
}

function emit(message: any) {
  for (const listener of messageListeners) listener(message);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  messageListeners.clear();
  sent.length = 0;
  playTrack.mockClear();
  seek.mockClear();
  pause.mockClear();
  resume.mockClear();
  skipNext.mockClear();
  useLobbyStore.setState({ role: null, code: null, playback: null, joinState: "idle" });
  startLobbySync();
});

afterEach(() => {
  stopLobbySync();
});

describe("lobby sync bridge", () => {
  it("loads the host's track on a listener", async () => {
    useLobbyStore.setState({ role: "listener", code: "4821" });
    player.currentTrack = track("old");
    player.status = "playing";

    emit({
      type: "playback",
      track: track("new"),
      queue: [track("new"), track("later")],
      index: 0,
      positionMs: 40_000,
      status: "playing",
      sentAt: 1_000,
      serverTime: 1_000,
    });
    await flush();

    expect(playTrack).toHaveBeenCalledTimes(1);
    expect(playTrack.mock.calls[0][0].id).toBe("new");
    expect(seek).toHaveBeenCalledWith(40_000);
  });

  it("pulls a drifting listener back without switching tracks", async () => {
    useLobbyStore.setState({ role: "listener", code: "4821" });
    player.currentTrack = track("same");
    player.status = "playing";
    player.positionMs = 10_000;

    emit({
      type: "playback",
      track: track("same"),
      queue: [track("same")],
      index: 0,
      positionMs: 30_000,
      status: "playing",
      sentAt: 1_000,
      serverTime: 1_000,
    });
    await flush();

    expect(playTrack).not.toHaveBeenCalled();
    expect(seek).toHaveBeenCalledWith(30_000);
  });

  it("pauses when the host pauses", async () => {
    useLobbyStore.setState({ role: "listener", code: "4821" });
    player.currentTrack = track("same");
    player.status = "playing";
    player.positionMs = 30_000;

    emit({
      type: "playback",
      track: track("same"),
      queue: [track("same")],
      index: 0,
      positionMs: 30_000,
      status: "paused",
      sentAt: 1_000,
      serverTime: 1_000,
    });
    await flush();

    expect(pause).toHaveBeenCalled();
  });

  it("ignores playback from the room while being the host", async () => {
    useLobbyStore.setState({ role: "host", code: "4821" });
    player.currentTrack = track("mine");
    player.status = "playing";

    emit({
      type: "playback",
      track: track("other"),
      queue: [],
      index: 0,
      positionMs: 0,
      status: "playing",
      sentAt: 1_000,
      serverTime: 1_000,
    });
    await flush();

    expect(playTrack).not.toHaveBeenCalled();
  });

  it("skips for the host when enough listeners voted", async () => {
    useLobbyStore.setState({ role: "host", code: "4821" });
    emit({ type: "skip_passed", votes: 2, needed: 2 });
    await flush();
    expect(skipNext).toHaveBeenCalled();
  });

  it("publishes the host's transport to the room", async () => {
    useLobbyStore.setState({ role: "host", code: "4821" });
    player.currentTrack = track("mine");
    player.status = "playing";
    player.positionMs = 5_000;
    player.queue = [track("mine")];
    player.currentIndex = 0;

    sent.length = 0;
    emit({ type: "lobby_state", role: "host", code: "4821", hostName: "Fufi", hostUserId: "u1", members: [], pending: [], playback: null, settings: { voteOrder: true }, serverTime: 1_000 });
    await flush();

    const playback = sent.find((message) => message.type === "playback");
    expect(playback).toBeTruthy();
    expect(playback.track.id).toBe("mine");
    expect(playback.status).toBe("playing");
  });
});
