// Run with: node --test server/lobby/
import test from "node:test";
import assert from "node:assert/strict";
import {
  LobbyServer,
  DENY_COOLDOWN_MS,
  MAX_REQUESTS,
  REQUEST_TTL_MS,
  sanitizeTrack,
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

// ── wishes + vote reliability (0.1.52) ───────────────────────────────────

function threeWay() {
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
  return { h, host, a, b, code };
}

test("a skip vote survives the host's one-second playback updates", () => {
  const { h, host, a } = threeWay();
  const track = { id: "t1", title: "Midnight Drive" };
  for (let tick = 0; tick < 5; tick += 1) {
    h.server.handle(host, {
      type: "playback",
      track,
      queue: [track, { id: "t2" }, { id: "t3" }],
      index: 0,
      positionMs: tick * 1000,
      status: "playing",
    });
  }

  h.server.handle(a, { type: "vote", target: "skip" });
  h.advance(1000);
  // the host keeps publishing the same track
  for (let tick = 6; tick < 10; tick += 1) {
    h.server.handle(host, {
      type: "playback",
      track,
      queue: [track, { id: "t2" }, { id: "t3" }],
      index: 0,
      positionMs: tick * 1000,
      status: "playing",
    });
  }

  const votes = a.box.sent.filter((m) => m.type === "votes").at(-1);
  assert.deepEqual(votes.skip, ["a"], "the vote is still there after 5 updates");
});

test("a skip vote resets when the room moves to the next track", () => {
  const { h, host, a } = threeWay();
  h.server.handle(host, {
    type: "playback",
    track: { id: "t1" },
    queue: [{ id: "t1" }, { id: "t2" }],
    index: 0,
    status: "playing",
  });
  h.server.handle(a, { type: "vote", target: "skip" });
  h.server.handle(host, {
    type: "playback",
    track: { id: "t2" },
    queue: [{ id: "t1" }, { id: "t2" }],
    index: 1,
    status: "playing",
  });
  const votes = a.box.sent.filter((m) => m.type === "votes").at(-1);
  assert.deepEqual(votes.skip, [], "votes belong to the track they were cast for");
});

test("tracks are sanitised before they leave the server", () => {
  const clean = sanitizeTrack({
    id: " abc ",
    title: "Song",
    artists: "A, B",
    coverUrl: "https://c/x.jpg",
    durationMs: 213000,
    secret: "nope",
  });
  assert.deepEqual(clean, {
    id: "abc",
    title: "Song",
    artists: "A, B",
    coverUrl: "https://c/x.jpg",
    durationMs: 213000,
  });
  assert.equal(sanitizeTrack({ title: "no id" }), null);
  assert.equal(sanitizeTrack(null), null);
});

test("wish flow: request, support vote, accept", () => {
  const { h, host, a, b } = threeWay();
  const track = { id: "w1", title: "Wish", artists: "Someone", durationMs: 200000 };

  h.server.handle(a, { type: "request_track", track });
  let requests = a.box.sent.filter((m) => m.type === "requests").at(-1).requests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].track.title, "Wish");
  assert.equal(requests[0].name, "Mira");
  assert.deepEqual(requests[0].voters, ["a"]);
  assert.ok(host.box.sent.some((m) => m.type === "requests"), "the host is told as well");

  // the second listener supports the same wish instead of creating a second one
  h.server.handle(b, { type: "request_track", track });
  requests = b.box.sent.filter((m) => m.type === "requests").at(-1).requests;
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].voters.sort(), ["a", "b"]);

  // host accepts
  const requestId = requests[0].id;
  host.box.sent.length = 0;
  h.server.handle(host, { type: "answer_request", requestId, accept: true });

  const accepted = a.box.sent.filter((m) => m.type === "request_accepted").at(-1);
  assert.equal(accepted.track.id, "w1");
  assert.equal(accepted.requestedBy, "Mira");
  assert.equal(a.box.sent.filter((m) => m.type === "requests").at(-1).requests.length, 0);
  assert.equal(host.box.sent.filter((m) => m.type === "request_accepted").at(-1).track.id, "w1");
});

test("a denied wish tells the requester to keep listening", () => {
  const { h, host, a } = threeWay();
  h.server.handle(a, { type: "request_track", track: { id: "w2", title: "Nope" } });
  const requestId = a.box.sent.filter((m) => m.type === "requests").at(-1).requests[0].id;

  a.box.sent.length = 0;
  h.server.handle(host, { type: "answer_request", requestId, accept: false });

  const denied = a.box.sent.find((m) => m.type === "request_denied");
  assert.equal(denied.reason, "denied");
  assert.equal(denied.track.id, "w2");
  assert.equal(a.box.sent.filter((m) => m.type === "requests").at(-1).requests.length, 0);
});

test("listeners cannot answer wishes, the host cannot wish", () => {
  const { h, host, a } = threeWay();
  h.server.handle(a, { type: "request_track", track: { id: "w3", title: "Mine" } });
  const requestId = a.box.sent.filter((m) => m.type === "requests").at(-1).requests[0].id;

  h.server.handle(a, { type: "answer_request", requestId, accept: true });
  assert.ok(a.box.sent.some((m) => m.type === "error" && m.code === "not_host"));

  host.box.sent.length = 0;
  h.server.handle(host, { type: "request_track", track: { id: "w4", title: "Mine" } });
  assert.ok(host.box.sent.some((m) => m.type === "error" && m.code === "host_requests"));
});

test("wishes can be switched off and withdrawn", () => {
  const { h, host, a } = threeWay();
  h.server.handle(host, { type: "lobby_settings", allowRequests: false });
  a.box.sent.length = 0;
  h.server.handle(a, { type: "request_track", track: { id: "w5", title: "Off" } });
  assert.ok(a.box.sent.some((m) => m.type === "request_denied" && m.reason === "disabled"));

  h.server.handle(host, { type: "lobby_settings", allowRequests: true });
  h.server.handle(a, { type: "request_track", track: { id: "w6", title: "On" } });
  const requestId = a.box.sent.filter((m) => m.type === "requests").at(-1).requests[0].id;
  h.server.handle(a, { type: "withdraw_request", requestId });
  assert.equal(a.box.sent.filter((m) => m.type === "requests").at(-1).requests.length, 0);
});

test("old wishes are swept away and the list is capped", () => {
  const { h, a } = threeWay();
  for (let i = 0; i < MAX_REQUESTS + 3; i += 1) {
    h.server.handle(a, { type: "request_track", track: { id: `cap-${i}`, title: `T${i}` } });
  }
  let requests = a.box.sent.filter((m) => m.type === "requests").at(-1).requests;
  assert.equal(requests.length, MAX_REQUESTS);

  h.advance(REQUEST_TTL_MS + 1000);
  h.server.sweep();
  requests = a.box.sent.filter((m) => m.type === "requests").at(-1).requests;
  assert.equal(requests.length, 0);
});

test("the host can kick a member (and only the host)", () => {
  const { h, host, a, b } = threeWay();
  b.box.sent.length = 0;
  h.server.handle(a, { type: "kick", userId: "b" });
  assert.ok(a.box.sent.some((m) => m.type === "error" && m.code === "not_host"));
  assert.equal(b.box.sent.length, 0, "nothing happened");

  h.server.handle(host, { type: "kick", userId: "b" });
  assert.ok(b.box.sent.some((m) => m.type === "kicked"));
  const members = host.box.sent.filter((m) => m.type === "members").at(-1).members;
  assert.deepEqual(members.map((m) => m.userId), ["a"]);
});
