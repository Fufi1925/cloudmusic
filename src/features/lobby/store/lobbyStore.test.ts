import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: any[] = [];

vi.mock("@/shared/lobby", () => ({
  lobbyClient: {
    send: (message: any) => sent.push(message),
    setUrl: () => {},
    start: () => {},
    stop: () => {},
    isConnected: () => true,
  },
  getDefaultLobbyUrl: () => "ws://test/v1/lobby/ws",
  normalizeLobbyUrl: (url: string) => url,
  storeLobbyUrl: () => {},
}));

const { useLobbyStore } = await import("./lobbyStore");

function track(id: string, title = id) {
  return { id, title, artists: "Artist", coverUrl: "", durationMs: 200_000, playCount: 0 };
}

function wish(id: string, trackId = "w1", name = "Mira", votes = ["u2"]) {
  return {
    id,
    userId: "u2",
    name,
    track: track(trackId),
    createdAt: 1,
    voters: votes,
    voteCount: votes.length,
  };
}

beforeEach(() => {
  sent.length = 0;
  useLobbyStore.setState({
    role: "listener",
    code: "4821",
    members: [],
    pending: [],
    requests: [],
    votes: { skip: [], skipNeeded: 0, tracks: {} },
    settings: { voteOrder: true, allowRequests: true },
    notice: null,
    joinState: "idle",
  });
});

describe("lobby store: song wishes", () => {
  it("keeps the wish list the server sends", () => {
    useLobbyStore.getState().handleServerMessage({ type: "requests", requests: [wish("r1")] } as any);
    expect(useLobbyStore.getState().requests).toHaveLength(1);
    expect(useLobbyStore.getState().requests[0].track.title).toBe("w1");
  });

  it("sends a wish as a listener and ignores it as the host", () => {
    useLobbyStore.getState().requestTrack(track("w2") as any);
    expect(sent.at(-1)).toMatchObject({ type: "request_track" });

    useLobbyStore.setState({ role: "host" });
    sent.length = 0;
    useLobbyStore.getState().requestTrack(track("w3") as any);
    expect(sent).toHaveLength(0);
  });

  it("answers a wish as the host and drops it locally", () => {
    useLobbyStore.setState({ role: "host", requests: [wish("r1"), wish("r2", "w2")] as any });
    useLobbyStore.getState().answerRequest("r1", true);
    expect(sent.at(-1)).toEqual({ type: "answer_request", requestId: "r1", accept: true });
    expect(useLobbyStore.getState().requests.map((r) => r.id)).toEqual(["r2"]);
  });

  it("does not let a listener answer wishes", () => {
    useLobbyStore.setState({ role: "listener", requests: [wish("r1")] as any });
    useLobbyStore.getState().answerRequest("r1", true);
    expect(sent).toHaveLength(0);
    expect(useLobbyStore.getState().requests).toHaveLength(1);
  });

  it("confirms an accepted wish and removes it from the list", () => {
    useLobbyStore.setState({ requests: [wish("r1"), wish("r2", "w2")] as any });
    useLobbyStore.getState().handleServerMessage({
      type: "request_accepted",
      requestId: "r1",
      track: track("w1"),
      requestedBy: "Mira",
    } as any);

    expect(useLobbyStore.getState().requests.map((r) => r.id)).toEqual(["r2"]);
    expect(useLobbyStore.getState().notice?.key).toBe("lobby.notice.request_accepted");
  });

  it("explains why a wish was refused", () => {
    const cases: Array<[string, string]> = [
      ["denied", "lobby.notice.request_denied"],
      ["disabled", "lobby.notice.requests_disabled"],
      ["full", "lobby.notice.requests_full"],
    ];
    for (const [reason, key] of cases) {
      useLobbyStore.getState().handleServerMessage({ type: "request_denied", reason } as any);
      expect(useLobbyStore.getState().notice?.key).toBe(key);
    }
  });

  it("lets the host switch wishes off", () => {
    useLobbyStore.setState({ role: "host" });
    useLobbyStore.getState().setAllowRequests(false);
    expect(useLobbyStore.getState().settings.allowRequests).toBe(false);
    expect(sent.at(-1)).toMatchObject({ type: "lobby_settings", allowRequests: false });
  });
});

describe("lobby store: moderation", () => {
  it("kicks only as the host", () => {
    useLobbyStore.getState().kickMember("u2");
    expect(sent).toHaveLength(0);

    useLobbyStore.setState({ role: "host" });
    useLobbyStore.getState().kickMember("u2");
    expect(sent.at(-1)).toEqual({ type: "kick", userId: "u2" });
  });

  it("drops the whole lobby state when kicked", () => {
    useLobbyStore.setState({ role: "listener", code: "4821", members: [{ userId: "u2", name: "Mira" }] as any });
    useLobbyStore.getState().handleServerMessage({ type: "kicked", name: "Mira" } as any);

    const state = useLobbyStore.getState();
    expect(state.role).toBeNull();
    expect(state.code).toBeNull();
    expect(state.members).toHaveLength(0);
    expect(state.notice?.key).toBe("lobby.notice.kicked");
  });
});

describe("lobby store: votes", () => {
  it("keeps skip votes that came from the server", () => {
    useLobbyStore.getState().handleServerMessage({
      type: "votes",
      skip: ["u2"],
      skipNeeded: 2,
      tracks: {},
    } as any);
    expect(useLobbyStore.getState().votes.skip).toEqual(["u2"]);
  });

  it("toggles a track vote for the queue", () => {
    useLobbyStore.getState().vote("t3");
    expect(sent.at(-1)).toEqual({ type: "vote", target: "t3" });
  });

  it("counts a request vote", () => {
    useLobbyStore.getState().voteRequest("r1");
    expect(sent.at(-1)).toEqual({ type: "vote_request", requestId: "r1" });
  });
});
