// Run with: node --test server/lobby/
import test from "node:test";
import assert from "node:assert/strict";
import {
  LobbyServer,
  DENY_COOLDOWN_MS,
  HOST_RESUME_GRACE_MS,
  LISTENER_RESUME_GRACE_MS,
  generateCode,
  isValidCode,
  skipVotesNeeded,
} from "./lobbyServer.mjs";
import { acceptKey, decodeFrames, encodeFrame } from "./ws.mjs";

function makeHarness({ start = 1_700_000_000_000 } = {}) {
  let clock = start;
  const server = new LobbyServer({ now: () => clock, random: () => 0.42 });

  function session(userId, name) {
    const box = { sent: [] };
    const s = {
      id: `${userId}-session`,
      userId,
      name,
      send: (payload) => box.sent.push(payload),
      box,
    };
    server.register(s);
    return s;
  }

  return {
    server,
    session,
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
}

test("codes are four digits and never start with a zero", () => {
  assert.equal(generateCode(() => 0), "1000");
  assert.equal(generateCode(() => 0.9999), "9999");
  assert.equal(isValidCode("4821"), true);
  assert.equal(isValidCode("0421"), false);
  assert.equal(isValidCode("482"), false);
  assert.equal(isValidCode(4821), false);
});

test("skip needs a majority of the listeners", () => {
  assert.equal(skipVotesNeeded(1), 1);
  assert.equal(skipVotesNeeded(2), 2);
  assert.equal(skipVotesNeeded(3), 2);
  assert.equal(skipVotesNeeded(4), 3);
  assert.equal(skipVotesNeeded(0), Infinity);
});

test("host creates a lobby and gets a code back", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });

  const state = host.box.sent.at(-1);
  assert.equal(state.type, "lobby_state");
  assert.equal(state.role, "host");
  assert.match(state.code, /^[1-9]\d{3}$/);
});

test("a listener must be approved before hearing anything", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;

  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  assert.equal(guest.box.sent.at(-1).type, "join_pending");
  assert.equal(host.box.sent.at(-1).type, "join_request");
  assert.equal(host.box.sent.at(-1).name, "Mira");

  h.server.handle(host, { type: "approve", userId: "guest-1" });
  const welcome = guest.box.sent.find((m) => m.type === "welcome");
  assert.equal(welcome.type, "welcome");
  assert.equal(welcome.role, "listener");
  assert.equal(welcome.code, code);
});

test("denied guests get a five minute cooldown before asking again", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;

  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "deny", userId: "guest-1" });
  assert.deepEqual(guest.box.sent.at(-1), {
    type: "join_denied",
    reason: "denied",
    retryAfterMs: DENY_COOLDOWN_MS,
  });

  // immediately again -> still blocked
  guest.box.sent.length = 0;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  assert.equal(guest.box.sent.at(-1).reason, "cooldown");
  assert.ok(guest.box.sent.at(-1).retryAfterMs > 0);

  // 4 minutes later: still blocked
  h.advance(4 * 60_000);
  guest.box.sent.length = 0;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  assert.equal(guest.box.sent.at(-1).reason, "cooldown");

  // after five minutes the request goes through again
  h.advance(61_000);
  guest.box.sent.length = 0;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  assert.equal(guest.box.sent.at(-1).type, "join_pending");
});

test("host playback reaches every listener with a server timestamp", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });
  guest.box.sent.length = 0;

  h.server.handle(host, {
    type: "playback",
    track: { id: "yt:abc", title: "Midnight Drive" },
    queue: [{ id: "yt:abc" }, { id: "yt:def" }],
    index: 0,
    positionMs: 42_000,
    status: "playing",
  });

  const event = guest.box.sent.find((m) => m.type === "playback");
  assert.ok(event, "listener received the playback event");
  assert.equal(event.positionMs, 42_000);
  assert.equal(event.track.id, "yt:abc");
  assert.equal(typeof event.sentAt, "number");
});

test("listeners cannot control playback", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  guest.box.sent.length = 0;
  h.server.handle(guest, { type: "playback", track: { id: "evil" } });
  assert.equal(guest.box.sent.length, 0, "nothing is relayed from a listener");
});

test("votes toggle, tallies reach everyone and half the listeners forces a skip", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const a = h.session("a", "Mira");
  const b = h.session("b", "Jonas");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  for (const guest of [a, b]) {
    h.server.handle(guest, { type: "join_request", code, name: guest.name });
    h.server.handle(host, { type: "approve", userId: guest.userId });
  }

  host.box.sent.length = 0;
  h.server.handle(a, { type: "vote", target: "skip" });
  let votes = a.box.sent.filter((m) => m.type === "votes").at(-1);
  assert.deepEqual(votes.skip, ["a"]);
  assert.equal(votes.skipNeeded, 2, "2 listeners -> both have to agree");
  assert.ok(!host.box.sent.some((m) => m.type === "skip_passed"));

  // toggling the same vote off removes it again
  h.server.handle(a, { type: "vote", target: "skip" });
  votes = a.box.sent.filter((m) => m.type === "votes").at(-1);
  assert.deepEqual(votes.skip, []);

  // a votes once more, b completes the majority -> host is told to skip
  h.server.handle(a, { type: "vote", target: "skip" });
  h.server.handle(b, { type: "vote", target: "skip" });
  assert.ok(host.box.sent.some((m) => m.type === "skip_passed"));
  votes = a.box.sent.filter((m) => m.type === "votes").at(-1);
  assert.deepEqual(votes.skip, [], "tally resets after the skip passed");
});

test("queue votes are collected per track and cleared with the next track", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  h.server.handle(host, {
    type: "playback",
    track: { id: "t1" },
    queue: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
    index: 0,
    positionMs: 0,
    status: "playing",
  });
  h.server.handle(guest, { type: "vote", target: "t3" });
  let votes = guest.box.sent.filter((m) => m.type === "votes").at(-1);
  assert.deepEqual(votes.tracks, { t3: ["guest-1"] });

  // host moves on -> stale votes disappear
  h.server.handle(host, { type: "playback", track: { id: "t2" }, queue: [{ id: "t2" }], index: 0 });
  votes = guest.box.sent.filter((m) => m.type === "votes").at(-1);
  assert.deepEqual(votes.tracks, {});
});

test("when the host leaves the lobby closes for everyone", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  h.server.handle(host, { type: "leave" });
  assert.equal(guest.box.sent.at(-1).type, "lobby_closed");
  assert.equal(h.server.lobbies.size, 0);
});

test("reconnecting with the same account skips the approval", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  // same account, new socket
  const again = h.session("guest-1", "Mira");
  h.server.handle(again, { type: "join_request", code, name: "Mira" });
  assert.equal(again.box.sent.at(-1).type, "welcome");
});

test("unknown codes are rejected without leaking whether they exist", () => {
  const h = makeHarness();
  const guest = h.session("guest-1", "Mira");
  h.server.handle(guest, { type: "join_request", code: "9999", name: "Mira" });
  assert.deepEqual(guest.box.sent.at(-1), {
    type: "join_denied",
    reason: "not_found",
    retryAfterMs: 0,
  });
});

test("a reconnecting host keeps its code and its listeners", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  // host drops the socket and comes back with the same account
  h.server.unregister(host);
  const hostAgain = h.session("host-1", "Fufi");
  hostAgain.id = "host-1-session-2";
  h.server.handle(hostAgain, { type: "resume", code });
  const state = hostAgain.box.sent.find((m) => m.type === "lobby_state");
  assert.ok(state, "host got its lobby back");
  assert.equal(state.code, code, "code did not change");

  // and it can still drive playback
  hostAgain.box.sent.length = 0;
  guest.box.sent.length = 0;
  h.server.handle(hostAgain, { type: "playback", track: { id: "x" }, status: "playing" });
  assert.ok(guest.box.sent.some((m) => m.type === "playback"));
});

test("a lobby whose host never comes back is closed after the grace period", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  h.server.unregister(host);
  h.advance(HOST_RESUME_GRACE_MS + 1_000);
  h.server.sweep();

  assert.equal(h.server.lobbies.size, 0);
  assert.equal(guest.box.sent.at(-1).type, "lobby_closed");
});

test("resuming a lobby that is gone reports it instead of joining silently", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  h.server.handle(host, { type: "resume", code: "4242" });
  assert.equal(host.box.sent.at(-1).type, "resume_failed");
});

test("a listener that reloads keeps its seat during the grace window", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  h.server.unregister(guest);
  let members = host.box.sent.filter((m) => m.type === "members").at(-1);
  assert.equal(members.members[0].online, false, "shown as offline, not gone");

  const back = h.session("guest-1", "Mira");
  back.id = "guest-1-session-2";
  h.server.handle(back, { type: "join_request", code, name: "Mira" });
  assert.equal(back.box.sent.find((m) => m.type === "welcome")?.role, "listener");

  members = host.box.sent.filter((m) => m.type === "members").at(-1);
  assert.equal(members.members[0].online, true);
});

test("a listener that stays away is dropped after the grace window", () => {
  const h = makeHarness();
  const host = h.session("host-1", "Fufi");
  const guest = h.session("guest-1", "Mira");
  h.server.handle(host, { type: "create_lobby", name: "Fufi" });
  const code = host.box.sent.at(-1).code;
  h.server.handle(guest, { type: "join_request", code, name: "Mira" });
  h.server.handle(host, { type: "approve", userId: "guest-1" });

  h.server.unregister(guest);
  h.advance(LISTENER_RESUME_GRACE_MS + 1_000);
  h.server.sweep();

  const members = host.box.sent.filter((m) => m.type === "members").at(-1);
  assert.deepEqual(members.members, []);
  assert.equal(h.server.lobbies.get(code).members.size, 0);
});

test("websocket framing round-trips a text payload", () => {
  const payload = Buffer.from(JSON.stringify({ type: "hello", name: "Mira" }), "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i & 3];
  const clientFrame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);

  const { frames, rest } = decodeFrames(clientFrame);
  assert.equal(rest.length, 0);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.toString("utf8"), JSON.stringify({ type: "hello", name: "Mira" }));
});

test("accept key matches the RFC example", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});
