import { create } from "zustand";
import {
  getDefaultLobbyUrl,
  lobbyClient,
  normalizeLobbyUrl,
  storeLobbyUrl,
} from "@/shared/lobby";
import type {
  LobbyConnectionStatus,
  LobbyJoinRequest,
  LobbyJoinState,
  LobbyMember,
  LobbyPlayback,
  LobbyRole,
  LobbyServerMessage,
  LobbySettings,
  LobbyVotes,
} from "@/shared/lobby";

const EMPTY_VOTES: LobbyVotes = { skip: [], skipNeeded: 0, tracks: {} };
const DEFAULT_SETTINGS: LobbySettings = { voteOrder: true };

export interface LobbyStoreState {
  role: LobbyRole | null;
  code: string | null;
  hostName: string | null;
  members: LobbyMember[];
  /** host only: guests waiting for a yes/no */
  pending: LobbyJoinRequest[];
  connection: LobbyConnectionStatus;
  joinState: LobbyJoinState;
  joinReason: string | null;
  retryAt: number | null;
  votes: LobbyVotes;
  settings: LobbySettings;
  playback: LobbyPlayback | null;
  serverUrl: string;
  /** transient hint for the UI (“Host hat den Song geskippt”) */
  notice: { key: string; at: number } | null;

  setServerUrl: (url: string) => void;
  createLobby: () => void;
  joinLobby: (code: string) => void;
  cancelJoin: () => void;
  leaveLobby: () => void;
  approve: (userId: string) => void;
  deny: (userId: string) => void;
  vote: (target: string) => void;
  setNotice: (key: string | null) => void;
  handleServerMessage: (message: LobbyServerMessage) => void;
  handleConnectionState: (state: "connecting" | "connected" | "closed") => void;
  reset: () => void;
}

const initial = {
  role: null as LobbyRole | null,
  code: null as string | null,
  hostName: null as string | null,
  members: [] as LobbyMember[],
  pending: [] as LobbyJoinRequest[],
  connection: "idle" as LobbyConnectionStatus,
  joinState: "idle" as LobbyJoinState,
  joinReason: null as string | null,
  retryAt: null as number | null,
  votes: EMPTY_VOTES,
  settings: DEFAULT_SETTINGS,
  playback: null as LobbyPlayback | null,
  notice: null as { key: string; at: number } | null,
};

export const useLobbyStore = create<LobbyStoreState>((set, get) => ({
  ...initial,
  serverUrl: getDefaultLobbyUrl(),

  setServerUrl: (url) => {
    const normalized = normalizeLobbyUrl(url);
    storeLobbyUrl(url);
    set({ serverUrl: normalized });
    if (!url.trim()) {
      set({ serverUrl: getDefaultLobbyUrl() });
      lobbyClient.setUrl(getDefaultLobbyUrl());
      return;
    }
    lobbyClient.setUrl(normalized);
  },

  createLobby: () => {
    const { serverUrl } = get();
    lobbyClient.setUrl(serverUrl);
    lobbyClient.start(serverUrl);
    set({
      role: "host",
      connection: lobbyClient.isConnected() ? "connected" : "connecting",
      joinState: "idle",
      joinReason: null,
      retryAt: null,
      members: [],
      pending: [],
      votes: EMPTY_VOTES,
      playback: null,
    });
    lobbyClient.send({ type: "create_lobby" });
  },

  joinLobby: (code) => {
    const clean = code.replace(/\D/g, "").slice(0, 4);
    if (clean.length !== 4) {
      set({ joinState: "denied", joinReason: "invalid_code", retryAt: null });
      return;
    }
    const { serverUrl } = get();
    lobbyClient.setUrl(serverUrl);
    lobbyClient.start(serverUrl);
    set({
      code: clean,
      joinState: "requesting",
      joinReason: null,
      retryAt: null,
      connection: lobbyClient.isConnected() ? "connected" : "connecting",
    });
    lobbyClient.send({ type: "join_request", code: clean });
  },

  cancelJoin: () => {
    set({ joinState: "idle", code: null, joinReason: null, retryAt: null });
  },

  leaveLobby: () => {
    if (get().role) lobbyClient.send({ type: "leave" });
    lobbyClient.stop();
    get().reset();
  },

  approve: (userId) => {
    lobbyClient.send({ type: "approve", userId });
    set((state) => ({ pending: state.pending.filter((request) => request.userId !== userId) }));
  },

  deny: (userId) => {
    lobbyClient.send({ type: "deny", userId });
    set((state) => ({ pending: state.pending.filter((request) => request.userId !== userId) }));
  },

  vote: (target) => {
    if (!get().role) return;
    lobbyClient.send({ type: "vote", target });
  },

  setNotice: (key) => set({ notice: key ? { key, at: Date.now() } : null }),

  handleConnectionState: (state) => {
    if (!get().role && get().joinState === "idle") return;
    set({
      connection:
        state === "connected"
          ? "connected"
          : state === "connecting"
            ? get().connection === "connected"
              ? "reconnecting"
              : "connecting"
            : get().role
              ? "reconnecting"
              : "error",
    });
  },

  reset: () =>
    set({
      ...initial,
      serverUrl: get().serverUrl,
    }),

  handleServerMessage: (message) => {
    switch (message.type) {
      case "lobby_state":
      case "welcome": {
        set({
          role: message.role,
          code: message.code,
          hostName: message.hostName,
          members: message.members,
          pending: message.role === "host" ? message.pending : [],
          playback: message.playback,
          settings: message.settings,
          joinState: "idle",
          joinReason: null,
          retryAt: null,
          connection: "connected",
        });
        break;
      }
      case "members":
        set({ members: message.members, hostName: message.hostName, settings: message.settings });
        break;
      case "playback":
        set({
          playback: {
            track: message.track,
            queue: message.queue,
            index: message.index,
            positionMs: message.positionMs,
            status: message.status,
            sentAt: message.sentAt,
            rev: message.rev,
          },
        });
        break;
      case "votes":
        set({
          votes: { skip: message.skip, skipNeeded: message.skipNeeded, tracks: message.tracks },
        });
        break;
      case "join_pending":
        set({ joinState: "pending", code: message.code, connection: "connected" });
        break;
      case "join_request": {
        const request: LobbyJoinRequest = {
          userId: message.userId,
          name: message.name,
          requestedAt: message.requestedAt,
        };
        set((state) => ({
          pending: [...state.pending.filter((entry) => entry.userId !== request.userId), request],
        }));
        break;
      }
      case "join_request_resolved": {
        const { userId } = message;
        set((state) => ({ pending: state.pending.filter((entry) => entry.userId !== userId) }));
        break;
      }
      case "join_request_gone": {
        const { userId } = message;
        set((state) => ({
          pending: state.pending.filter((entry) => entry.userId !== userId),
          notice: { key: "lobby.notice.guest_gone", at: Date.now() },
        }));
        break;
      }
      case "join_denied":
        set({
          joinState: message.reason === "denied" || message.reason === "cooldown" ? "cooldown" : "denied",
          joinReason: message.reason,
          retryAt: message.retryAfterMs > 0 ? Date.now() + message.retryAfterMs : null,
          connection: "idle",
        });
        break;
      case "skip_passed":
        set({ notice: { key: "lobby.notice.skip_passed", at: Date.now() } });
        break;
      case "lobby_closed":
        set({
          ...initial,
          serverUrl: get().serverUrl,
          notice: {
            key: message.reason === "expired" ? "lobby.notice.expired" : "lobby.notice.closed",
            at: Date.now(),
          },
        });
        break;
      case "resume_failed":
        set({
          ...initial,
          serverUrl: get().serverUrl,
          notice: { key: "lobby.notice.closed", at: Date.now() },
        });
        break;
      case "error":
        set({ joinReason: message.code, joinState: "denied" });
        break;
      default:
        break;
    }
  },
}));

export function selectIsInLobby(state: LobbyStoreState): boolean {
  return state.role !== null;
}

export function selectIsListener(state: LobbyStoreState): boolean {
  return state.role === "listener";
}
