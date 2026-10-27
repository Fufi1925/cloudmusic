import type { Track } from "../types";

/** who controls playback */
export type LobbyRole = "host" | "listener";

/** connection state of the lobby socket */
export type LobbyConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

/** the listener's own join attempt */
export type LobbyJoinState = "idle" | "requesting" | "pending" | "denied" | "cooldown";

export interface LobbyMember {
  userId: string;
  name: string;
  joinedAt: number;
  /** a listener that reloaded keeps its seat but is marked offline */
  online?: boolean;
}

export interface LobbyJoinRequest {
  userId: string;
  name: string;
  requestedAt: number;
}

export interface LobbyPlayback {
  track: Track | null;
  queue: Track[];
  index: number;
  positionMs: number;
  status: "playing" | "paused";
  /** server clock when the state was captured */
  sentAt: number;
  rev?: number;
}

export interface LobbyVotes {
  skip: string[];
  skipNeeded: number;
  tracks: Record<string, string[]>;
}

/** a listener's song wish, waiting for the host's yes/no */
export interface LobbyTrackRequest {
  id: string;
  userId: string;
  name: string;
  track: Track;
  createdAt: number;
  /** everyone who supports this wish (the requester is included) */
  voters: string[];
  voteCount: number;
}

export interface LobbySettings {
  voteOrder: boolean;
  allowRequests: boolean;
}

export type LobbyRequestDenyReason = "denied" | "disabled" | "full";

// ── client → server ──────────────────────────────────────────────────────

export type LobbyClientMessage =
  | { type: "hello"; userId: string; name: string; clientVersion?: string }
  | { type: "ping"; t0: number }
  | { type: "create_lobby"; name?: string }
  | { type: "resume"; code: string }
  | { type: "join_request"; code: string; name?: string }
  | { type: "approve"; userId: string }
  | { type: "deny"; userId: string }
  | { type: "leave" }
  | { type: "lobby_settings"; voteOrder: boolean }
  | { type: "vote"; target: string }
  | { type: "request_track"; track: Track }
  | { type: "vote_request"; requestId: string }
  | { type: "withdraw_request"; requestId: string }
  | { type: "answer_request"; requestId: string; accept: boolean }
  | { type: "kick"; userId: string }
  | {
      type: "playback";
      track: Track | null;
      queue: Track[];
      index: number;
      positionMs: number;
      status: "playing" | "paused";
    };

// ── server → client ──────────────────────────────────────────────────────

export type LobbyServerMessage =
  | { type: "hello"; sessionId: string; serverTime: number; path: string }
  | { type: "hello_ok"; sessionId: string; serverTime: number }
  | { type: "pong"; t0: number; t1: number }
  | { type: "error"; code: string; message: string }
  | {
      type: "lobby_state";
      role: LobbyRole;
      code: string;
      hostName: string;
      hostUserId: string;
      members: LobbyMember[];
      pending: LobbyJoinRequest[];
      playback: LobbyPlayback;
      requests?: LobbyTrackRequest[];
      settings: LobbySettings;
      serverTime: number;
    }
  | {
      type: "welcome";
      role: LobbyRole;
      code: string;
      hostName: string;
      hostUserId: string;
      members: LobbyMember[];
      pending: LobbyJoinRequest[];
      playback: LobbyPlayback;
      requests?: LobbyTrackRequest[];
      settings: LobbySettings;
      serverTime: number;
    }
  | { type: "members"; hostName: string; members: LobbyMember[]; settings: LobbySettings }
  | { type: "playback"; serverTime: number } & LobbyPlayback
  | { type: "votes" } & LobbyVotes
  | { type: "requests"; requests: LobbyTrackRequest[] }
  | { type: "request_accepted"; requestId: string; track: Track; requestedBy: string }
  | {
      type: "request_denied";
      requestId?: string;
      reason: LobbyRequestDenyReason;
      track?: Track;
    }
  | { type: "kicked"; name: string }
  | { type: "join_pending"; code: string }
  | { type: "join_request"; userId: string; name: string; requestedAt: number }
  | { type: "join_request_resolved"; userId: string; accepted: boolean }
  | { type: "join_request_gone"; userId: string }
  | { type: "join_denied"; reason: "denied" | "cooldown" | "not_found" | "full" | "busy" | "host_away"; retryAfterMs: number }
  | { type: "skip_passed"; votes: number; needed: number }
  | { type: "lobby_closed"; reason: string }
  | { type: "resume_failed" }
  | { type: "left" };

export type { Track };
