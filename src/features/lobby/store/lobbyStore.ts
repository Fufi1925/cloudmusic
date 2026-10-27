import { create } from "zustand";
import { getAuthSession } from "@/shared/api/auth-session";
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
  LobbyTrackRequest,
  LobbyVotes,
  Track,
} from "@/shared/lobby";

const EMPTY_VOTES: LobbyVotes = { skip: [], skipNeeded: 0, tracks: {} };
const DEFAULT_SETTINGS: LobbySettings = { voteOrder: true, allowRequests: true };

const SESSION_KEY = "cloudmusic_lobby_session";

/** the lobby survives a reload: the code + role are enough to re-attach */
export function persistLobbySession(code: string | null, role: LobbyRole | null): void {
  try {
    if (code && role) localStorage.setItem(SESSION_KEY, JSON.stringify({ code, role }));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode – the lobby just won't survive a reload */
  }
}

function readLobbySession(): { code: string; role: LobbyRole } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.code !== "string" || (parsed.role !== "host" && parsed.role !== "listener")) {
      return null;
    }
    return { code: parsed.code, role: parsed.role };
  } catch {
    return null;
  }
}

/** the signed-in account, as the lobby server knows it */
export function getLobbyUserId(): string | null {
  try {
    return getAuthSession()?.user?.id ?? null;
  } catch {
    return null;
  }
}

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
  /** open song wishes, most supported first */
  requests: LobbyTrackRequest[];
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
  requestTrack: (track: Track) => void;
  voteRequest: (requestId: string) => void;
  withdrawRequest: (requestId: string) => void;
  answerRequest: (requestId: string, accept: boolean) => void;
  kickMember: (userId: string) => void;
  setAllowRequests: (allow: boolean) => void;
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
  requests: [] as LobbyTrackRequest[],
  settings: DEFAULT_SETTINGS,
  playback: null as LobbyPlayback | null,
  notice: null as { key: string; at: number } | null,
};

const restored = readLobbySession();

export const useLobbyStore = create<LobbyStoreState>((set, get) => ({
  ...initial,
  // a reload drops straight back into the lobby (the server resumes the seat)
  role: restored?.role ?? null,
  code: restored?.code ?? null,
  connection: restored ? "connecting" : "idle",
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
      requests: [],
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

  requestTrack: (track) => {
    if (get().role !== "listener" || !track?.id) return;
    lobbyClient.send({ type: "request_track", track });
  },

  voteRequest: (requestId) => {
    if (get().role !== "listener" || !requestId) return;
    lobbyClient.send({ type: "vote_request", requestId });
  },

  withdrawRequest: (requestId) => {
    if (!get().role || !requestId) return;
    lobbyClient.send({ type: "withdraw_request", requestId });
  },

  answerRequest: (requestId, accept) => {
    if (get().role !== "host" || !requestId) return;
    lobbyClient.send({ type: "answer_request", requestId, accept });
    set((state) => ({ requests: state.requests.filter((request) => request.id !== requestId) }));
  },

  kickMember: (userId) => {
    if (get().role !== "host" || !userId) return;
    lobbyClient.send({ type: "kick", userId });
  },

  setAllowRequests: (allow) => {
    if (get().role !== "host") return;
    const settings = { ...get().settings, allowRequests: Boolean(allow) };
    set({ settings });
    lobbyClient.send({ type: "lobby_settings", ...settings });
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

  reset: () => {
    persistLobbySession(null, null);
    set({
      ...initial,
      serverUrl: get().serverUrl,
    });
  },

  handleServerMessage: (message) => {
    switch (message.type) {
      case "lobby_state":
      case "welcome": {
        persistLobbySession(message.code, message.role);
        set({
          role: message.role,
          code: message.code,
          hostName: message.hostName,
          members: message.members,
          pending: message.role === "host" ? message.pending : [],
          playback: message.playback,
          requests: message.requests ?? [],
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
      case "requests":
        set({ requests: message.requests });
        break;
      case "request_accepted":
        set((state) => ({
          requests: state.requests.filter((request) => request.id !== message.requestId),
          notice: { key: "lobby.notice.request_accepted", at: Date.now() },
        }));
        break;
      case "request_denied":
        set((state) => ({
          requests: message.requestId
            ? state.requests.filter((request) => request.id !== message.requestId)
            : state.requests,
          notice: {
            key:
              message.reason === "disabled"
                ? "lobby.notice.requests_disabled"
                : message.reason === "full"
                  ? "lobby.notice.requests_full"
                  : "lobby.notice.request_denied",
            at: Date.now(),
          },
        }));
        break;
      case "kicked":
        persistLobbySession(null, null);
        set({
          ...initial,
          serverUrl: get().serverUrl,
          notice: { key: "lobby.notice.kicked", at: Date.now() },
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
        persistLobbySession(null, null);
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
        persistLobbySession(null, null);
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
