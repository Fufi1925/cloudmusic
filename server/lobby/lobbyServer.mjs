// Lobby ("Listen together") state machine.
//
// The server never touches audio: it only relays the host's transport state
// (track, queue, position, play state, timestamp) and the listeners' votes.
// Every client resolves the same track on its own, so there is no extra
// streaming cost and lyrics stay in sync because the position is in sync.
import { randomUUID } from "node:crypto";

export const DENY_COOLDOWN_MS = 5 * 60_000;
export const EMPTY_LOBBY_TTL_MS = 2 * 60 * 60_000;
/** a host that drops off (reload, wifi hiccup) gets this long to come back */
export const HOST_RESUME_GRACE_MS = 60_000;
/** a listener that drops off keeps its seat for a moment (reload, sleep) */
export const LISTENER_RESUME_GRACE_MS = 45_000;
export const MAX_MEMBERS = 25;
export const MAX_PENDING = 5;

/** 4-digit join code, never starting with 0 (easier to read out loud) */
export function generateCode(random = Math.random) {
  return String(1000 + Math.floor(random() * 9000));
}

export function isValidCode(code) {
  return typeof code === "string" && /^[1-9]\d{3}$/.test(code);
}

/** how many listener votes are needed to force a skip */
export function skipVotesNeeded(listenerCount) {
  if (listenerCount <= 0) return Infinity;
  // a plain majority: one listener can skip alone, two need both to agree
  return Math.floor(listenerCount / 2) + 1;
}

function nameOf(value, fallback = "Hörer") {
  const name = String(value ?? "").trim().slice(0, 40);
  return name || fallback;
}

export class LobbyServer {
  constructor({ now = Date.now, random = Math.random } = {}) {
    this.now = now;
    this.random = random;
    /** @type {Map<string, any>} code -> lobby */
    this.lobbies = new Map();
    /** @type {Map<string, any>} sessionId -> session */
    this.sessions = new Map();
    /** userId -> code, so a session can find its lobby again */
    this.codeBySession = new Map();
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  register(session) {
    this.sessions.set(session.id, session);
    return session;
  }

  unregister(session) {
    this.sessions.delete(session.id);
    this.handleDisconnect(session);
  }

  send(session, payload) {
    try {
      session.send?.(payload);
    } catch {
      /* dead socket – the transport layer cleans it up */
    }
  }

  lobbyOf(session) {
    const code = this.codeBySession.get(session.id);
    return code ? this.lobbies.get(code) : undefined;
  }

  /** host or a joined listener of the lobby */
  roleOf(lobby, userId) {
    if (!lobby) return null;
    if (lobby.hostUserId === userId) return "host";
    return lobby.members.has(userId) ? "listener" : null;
  }

  newCode() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateCode(this.random);
      if (!this.lobbies.has(code)) return code;
    }
    return null;
  }

  // ── lobby lifecycle ─────────────────────────────────────────────────────

  createLobby(session, message = {}) {
    this.leaveLobby(session, "switched");

    const code = this.newCode();
    if (!code) {
      this.send(session, { type: "error", code: "no_code", message: "Could not allocate a code" });
      return null;
    }

    const lobby = {
      code,
      createdAt: this.now(),
      hostUserId: session.userId,
      hostName: nameOf(message.name ?? session.name, "Host"),
      hostSessionId: session.id,
      hostOfflineSince: null,
      members: new Map(),
      pending: new Map(),
      denied: new Map(),
      playback: {
        track: null,
        queue: [],
        index: 0,
        positionMs: 0,
        status: "paused",
        sentAt: this.now(),
      },
      votes: { skip: new Map(), tracks: new Map() },
      settings: { voteOrder: true },
      lastActivityAt: this.now(),
    };

    this.lobbies.set(code, lobby);
    this.codeBySession.set(session.id, code);
    session.code = code;
    session.role = "host";

    this.send(session, {
      type: "lobby_state",
      role: "host",
      ...this.snapshot(lobby),
    });
    this.log("lobby_created", code, lobby.hostName);
    return lobby;
  }

  /**
   * Re-attach a socket to a lobby it was already part of – used after a
   * reconnect so the host keeps its code and listeners keep their seat.
   */
  resume(session, message = {}) {
    const code = String(message.code ?? "").trim();
    const lobby = this.lobbies.get(code);
    if (!lobby) {
      this.send(session, { type: "resume_failed" });
      return;
    }

    if (lobby.hostUserId === session.userId) {
      lobby.hostSessionId = session.id;
      lobby.hostOfflineSince = null;
      lobby.lastActivityAt = this.now();
      this.codeBySession.set(session.id, code);
      session.code = code;
      session.role = "host";
      this.send(session, { type: "lobby_state", role: "host", ...this.snapshot(lobby) });
      this.broadcastMembers(lobby);
      return;
    }

    const member = lobby.members.get(session.userId);
    if (member) {
      member.sessionId = session.id;
      member.offlineSince = null;
      member.name = nameOf(session.name, member.name);
      this.codeBySession.set(session.id, code);
      session.code = code;
      session.role = "listener";
      this.send(session, { type: "welcome", role: "listener", ...this.snapshot(lobby) });
      this.broadcastMembers(lobby);
      return;
    }

    this.send(session, { type: "resume_failed" });
  }

  requestJoin(session, message = {}) {
    const code = String(message.code ?? "").trim();
    const lobby = this.lobbies.get(code);
    if (!lobby) {
      this.send(session, { type: "join_denied", reason: "not_found", retryAfterMs: 0 });
      return;
    }

    // already in this lobby (also covers a reconnect) – no new approval needed
    if (this.roleOf(lobby, session.userId)) {
      const member = lobby.members.get(session.userId);
      if (member) {
        member.sessionId = session.id;
        member.offlineSince = null;
        member.name = nameOf(message.name ?? session.name);
        this.broadcastMembers(lobby);
      }
      this.codeBySession.set(session.id, code);
      session.code = code;
      session.name = nameOf(message.name ?? session.name);
      this.send(session, {
        type: "welcome",
        role: this.roleOf(lobby, session.userId),
        ...this.snapshot(lobby),
      });
      return;
    }

    const deniedAt = lobby.denied.get(session.userId);
    if (deniedAt && this.now() - deniedAt < DENY_COOLDOWN_MS) {
      this.send(session, {
        type: "join_denied",
        reason: "cooldown",
        retryAfterMs: DENY_COOLDOWN_MS - (this.now() - deniedAt),
      });
      return;
    }

    if (lobby.members.size >= MAX_MEMBERS) {
      this.send(session, { type: "join_denied", reason: "full", retryAfterMs: 0 });
      return;
    }
    if (lobby.pending.size >= MAX_PENDING) {
      this.send(session, { type: "join_denied", reason: "busy", retryAfterMs: 30_000 });
      return;
    }

    const name = nameOf(message.name ?? session.name);
    const previous = lobby.pending.get(session.userId);
    lobby.pending.set(session.userId, {
      userId: session.userId,
      sessionId: session.id,
      name,
      requestedAt: previous?.requestedAt ?? this.now(),
      attempts: (previous?.attempts ?? 0) + 1,
    });
    lobby.lastActivityAt = this.now();

    this.send(session, { type: "join_pending", code });

    const host = this.sessions.get(lobby.hostSessionId);
    if (host) {
      this.send(host, {
        type: "join_request",
        userId: session.userId,
        name,
        requestedAt: lobby.pending.get(session.userId).requestedAt,
      });
    } else {
      // nobody to approve it: tell the guest instead of leaving them hanging
      lobby.pending.delete(session.userId);
      this.send(session, { type: "join_denied", reason: "host_away", retryAfterMs: 15_000 });
    }
  }

  approve(session, message = {}) {
    const lobby = this.lobbyOf(session);
    if (!lobby || lobby.hostUserId !== session.userId) {
      this.send(session, { type: "error", code: "not_host", message: "Only the host can approve" });
      return;
    }
    const request = lobby.pending.get(message.userId);
    if (!request) return;

    lobby.pending.delete(request.userId);
    lobby.denied.delete(request.userId);
    lobby.members.set(request.userId, {
      userId: request.userId,
      sessionId: request.sessionId,
      name: request.name,
      joinedAt: this.now(),
      offlineSince: null,
    });
    lobby.lastActivityAt = this.now();

    const guest = this.sessions.get(request.sessionId);
    if (guest) {
      this.codeBySession.set(guest.id, lobby.code);
      guest.code = lobby.code;
      guest.role = "listener";
      this.send(guest, {
        type: "welcome",
        role: "listener",
        ...this.snapshot(lobby),
      });
    } else {
      // the guest closed the app while waiting – drop the membership again
      lobby.members.delete(request.userId);
      this.send(session, { type: "join_request_gone", userId: request.userId });
      return;
    }

    this.broadcastMembers(lobby);
    this.log("member_joined", lobby.code, request.name);
  }

  deny(session, message = {}) {
    const lobby = this.lobbyOf(session);
    if (!lobby || lobby.hostUserId !== session.userId) return;
    const request = lobby.pending.get(message.userId);
    if (!request) return;

    lobby.pending.delete(request.userId);
    lobby.denied.set(request.userId, this.now());
    lobby.lastActivityAt = this.now();

    const guest = this.sessions.get(request.sessionId);
    if (guest) {
      this.send(guest, {
        type: "join_denied",
        reason: "denied",
        retryAfterMs: DENY_COOLDOWN_MS,
      });
    }
    this.send(session, { type: "join_request_resolved", userId: request.userId, accepted: false });
    this.log("member_denied", lobby.code, request.name);
  }

  leaveLobby(session, reason = "left") {
    const lobby = this.lobbyOf(session);
    this.codeBySession.delete(session.id);
    session.code = undefined;
    session.role = undefined;
    if (!lobby) return;

    if (lobby.hostUserId === session.userId) {
      this.closeLobby(lobby, reason);
      return;
    }

    if (lobby.members.delete(session.userId)) {
      this.clearVotesOf(lobby, session.userId);
      this.broadcastMembers(lobby);
      this.broadcastVotes(lobby);
    }
  }

  closeLobby(lobby, reason = "closed") {
    this.lobbies.delete(lobby.code);
    for (const member of lobby.members.values()) {
      const guest = this.sessions.get(member.sessionId);
      if (guest) {
        this.codeBySession.delete(guest.id);
        guest.code = undefined;
        guest.role = undefined;
        this.send(guest, { type: "lobby_closed", reason });
      }
    }
    const host = this.sessions.get(lobby.hostSessionId);
    if (host) {
      this.codeBySession.delete(host.id);
      host.code = undefined;
      host.role = undefined;
    }
    this.log("lobby_closed", lobby.code, reason);
  }

  handleDisconnect(session) {
    const lobby = this.lobbyOf(session);
    if (lobby) {
      const member = lobby.members.get(session.userId);
      if (member && member.sessionId === session.id) {
        // keep the seat for a moment so a reload does not need a new approval
        member.offlineSince = this.now();
        member.sessionId = null;
        this.codeBySession.delete(session.id);
        session.code = undefined;
        session.role = undefined;
        this.broadcastMembers(lobby);
        return;
      }
    }
    if (lobby && lobby.hostUserId === session.userId) {
      // keep the code and the listeners for a moment: a reload or a short
      // network drop must not kick the whole room
      lobby.hostSessionId = null;
      lobby.hostOfflineSince = this.now();
      this.codeBySession.delete(session.id);
      session.code = undefined;
      session.role = undefined;
      return;
    }
    this.leaveLobby(session, "disconnected");
  }

  // ── playback relay ──────────────────────────────────────────────────────

  updatePlayback(session, message = {}) {
    const lobby = this.lobbyOf(session);
    if (!lobby || lobby.hostUserId !== session.userId) return;

    const sentAt = this.now();
    lobby.playback = {
      track: message.track ?? null,
      queue: Array.isArray(message.queue) ? message.queue.slice(0, 200) : lobby.playback.queue,
      index: Number.isFinite(message.index) ? message.index : 0,
      positionMs: Math.max(0, Number(message.positionMs) || 0),
      status: message.status === "playing" ? "playing" : "paused",
      sentAt,
      rev: (lobby.playback.rev ?? 0) + 1,
    };
    lobby.lastActivityAt = sentAt;

    // a new track wipes the votes it carried
    const trackId = lobby.playback.track?.id;
    if (trackId) {
      for (const id of [...lobby.votes.tracks.keys()]) {
        if (id !== trackId) lobby.votes.tracks.delete(id);
      }
      lobby.votes.skip.clear();
    }

    this.broadcastPlayback(lobby);
    this.broadcastVotes(lobby);
  }

  setSettings(session, message = {}) {
    const lobby = this.lobbyOf(session);
    if (!lobby || lobby.hostUserId !== session.userId) return;
    lobby.settings.voteOrder = Boolean(message.voteOrder);
    this.broadcastMembers(lobby);
  }

  broadcastPlayback(lobby) {
    const payload = { type: "playback", serverTime: this.now(), ...lobby.playback };
    for (const member of lobby.members.values()) {
      const guest = this.sessions.get(member.sessionId);
      if (guest) this.send(guest, payload);
    }
    const host = this.sessions.get(lobby.hostSessionId);
    if (host) this.send(host, payload);
  }

  // ── voting ──────────────────────────────────────────────────────────────

  vote(session, message = {}) {
    const lobby = this.lobbyOf(session);
    if (!lobby) return;
    if (lobby.hostUserId === session.userId) {
      this.send(session, { type: "error", code: "host_votes", message: "The host decides directly" });
      return;
    }
    if (!lobby.members.has(session.userId)) return;

    const target = String(message.target ?? "");
    const userId = session.userId;

    if (target === "skip") {
      const voting = lobby.votes.skip;
      if (voting.has(userId)) voting.delete(userId);
      else voting.set(userId, this.now());
    } else if (target) {
      let voters = lobby.votes.tracks.get(target);
      if (!voters) {
        voters = new Map();
        lobby.votes.tracks.set(target, voters);
      }
      if (voters.has(userId)) voters.delete(userId);
      else voters.set(userId, this.now());
      if (voters.size === 0) lobby.votes.tracks.delete(target);
    }

    lobby.lastActivityAt = this.now();
    this.broadcastVotes(lobby);

    const needed = skipVotesNeeded(lobby.members.size);
    if (lobby.votes.skip.size > 0 && lobby.votes.skip.size >= needed) {
      const host = this.sessions.get(lobby.hostSessionId);
      if (host) this.send(host, { type: "skip_passed", votes: lobby.votes.skip.size, needed });
      lobby.votes.skip.clear();
      this.broadcastVotes(lobby);
      this.log("skip_passed", lobby.code, `${needed} votes`);
    }
  }

  clearVotesOf(lobby, userId) {
    lobby.votes.skip.delete(userId);
    for (const [trackId, voters] of [...lobby.votes.tracks.entries()]) {
      voters.delete(userId);
      if (voters.size === 0) lobby.votes.tracks.delete(trackId);
    }
  }

  broadcastVotes(lobby) {
    const trackVotes = {};
    for (const [trackId, voters] of lobby.votes.tracks.entries()) {
      trackVotes[trackId] = [...voters.keys()];
    }
    const payload = {
      type: "votes",
      skip: [...lobby.votes.skip.keys()],
      skipNeeded: skipVotesNeeded(lobby.members.size),
      tracks: trackVotes,
    };
    for (const member of lobby.members.values()) {
      const guest = this.sessions.get(member.sessionId);
      if (guest) this.send(guest, payload);
    }
    const host = this.sessions.get(lobby.hostSessionId);
    if (host) this.send(host, payload);
  }

  broadcastMembers(lobby) {
    const payload = {
      type: "members",
      hostName: lobby.hostName,
      members: [...lobby.members.values()].map((m) => ({
        userId: m.userId,
        name: m.name,
        joinedAt: m.joinedAt,
        online: m.offlineSince === null,
      })),
      settings: lobby.settings,
    };
    for (const member of lobby.members.values()) {
      const guest = this.sessions.get(member.sessionId);
      if (guest) this.send(guest, payload);
    }
    const host = this.sessions.get(lobby.hostSessionId);
    if (host) this.send(host, payload);
  }

  // ── snapshots ───────────────────────────────────────────────────────────

  snapshot(lobby) {
    return {
      code: lobby.code,
      hostName: lobby.hostName,
      hostUserId: lobby.hostUserId,
      members: [...lobby.members.values()].map((m) => ({
        userId: m.userId,
        name: m.name,
        joinedAt: m.joinedAt,
        online: m.offlineSince === null,
      })),
      pending: [...lobby.pending.values()].map((p) => ({
        userId: p.userId,
        name: p.name,
        requestedAt: p.requestedAt,
      })),
      playback: lobby.playback,
      settings: lobby.settings,
      serverTime: this.now(),
    };
  }

  // ── housekeeping ────────────────────────────────────────────────────────

  /** drop lobbies that have been idle for too long (called on a timer) */
  sweep() {
    const now = this.now();
    for (const lobby of [...this.lobbies.values()]) {
      if (
        lobby.hostOfflineSince !== null &&
        lobby.hostOfflineSince !== undefined &&
        now - lobby.hostOfflineSince > HOST_RESUME_GRACE_MS
      ) {
        this.closeLobby(lobby, "host_gone");
        continue;
      }
      let removed = false;
      for (const [userId, member] of [...lobby.members.entries()]) {
        if (
          member.offlineSince !== null &&
          member.offlineSince !== undefined &&
          now - member.offlineSince > LISTENER_RESUME_GRACE_MS
        ) {
          lobby.members.delete(userId);
          this.clearVotesOf(lobby, userId);
          removed = true;
        }
      }
      if (removed) {
        this.broadcastMembers(lobby);
        this.broadcastVotes(lobby);
      }
      if (now - lobby.lastActivityAt < EMPTY_LOBBY_TTL_MS) continue;
      this.closeLobby(lobby, "expired");
    }
  }

  stats() {
    return {
      lobbies: this.lobbies.size,
      sessions: this.sessions.size,
      listeners: [...this.lobbies.values()].reduce((sum, l) => sum + l.members.size, 0),
    };
  }

  /** single entry point used by the transport layer */
  handle(session, message) {
    if (!session || !message || typeof message.type !== "string") return;
    switch (message.type) {
      case "ping":
        this.send(session, { type: "pong", t0: message.t0, t1: this.now() });
        return;
      case "create_lobby":
        this.createLobby(session, message);
        return;
      case "resume":
        this.resume(session, message);
        return;
      case "join_request":
        this.requestJoin(session, message);
        return;
      case "approve":
        this.approve(session, message);
        return;
      case "deny":
        this.deny(session, message);
        return;
      case "leave":
        this.leaveLobby(session, "left");
        this.send(session, { type: "left" });
        return;
      case "playback":
        this.updatePlayback(session, message);
        return;
      case "lobby_settings":
        this.setSettings(session, message);
        return;
      case "vote":
        this.vote(session, message);
        return;
      default:
        this.send(session, { type: "error", code: "unknown_type", message: `Unknown ${message.type}` });
    }
  }

  log(event, code, detail) {
    // eslint-disable-next-line no-console
    console.log(`[lobby] ${new Date(this.now()).toISOString()} ${event} ${code ?? ""} ${detail ?? ""}`.trim());
  }
}

export { randomUUID };
