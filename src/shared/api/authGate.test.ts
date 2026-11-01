import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { setHumanCheckPrompt } from "./humanCheck";

// the real solver is covered by proofOfWork.test.ts; here we only care that the
// proof is carried through the auth flow, so the runner answers instantly
vi.mock("./proofOfWorkRunner", () => ({
  solvePow: async (challenge: { token: string }) => ({ token: challenge.token, nonce: "7" }),
}));

// the auth gate lives inside api.login/register, so this test drives the public
// api functions against a faked fetch and checks the bodies that go out.

const TOKENS = {
  accessToken: "access",
  refreshToken: "refresh",
  user: { id: "u1", email: "a@b.c", username: "someone", displayName: "Someone" },
};

type Call = { url: string; init: RequestInit | undefined };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let calls: Call[] = [];
let handler: (call: Call) => Response | Promise<Response>;

function stubFetch() {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  });
}

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    mode: "required",
    algorithm: "argon2id-v1",
    token: "tok",
    salt: "c2FsdHNhbHQ",
    difficulty: 2,
    memoryKiB: 8,
    iterations: 1,
    parallelism: 1,
    hashLength: 32,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    turnstile: { mode: "off" },
    ...overrides,
  };
}

function bodyOf(call: Call) {
  return JSON.parse(String(call.init?.body ?? "{}"));
}

function callsTo(pathname: string) {
  return calls.filter((call) => new URL(call.url).pathname === pathname);
}

function lastBody(pathname: string) {
  const matches = callsTo(pathname);
  expect(matches.length).toBeGreaterThan(0);
  return bodyOf(matches[matches.length - 1]);
}

describe("auth gate", () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch();
  });

  afterEach(() => {
    setHumanCheckPrompt(null);
    vi.unstubAllGlobals();
  });

  it("sends the solved proof with the registration", async () => {
    handler = (call) => {
      if (call.url.endsWith("/v1/auth/challenge")) return json(challenge());
      if (call.url.endsWith("/v1/auth/register")) return json(TOKENS);
      throw new Error(`unexpected ${call.url}`);
    };

    await api.register("a@b.c", "password1", "Someone", "Someone");

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/v1/auth/challenge",
      "/v1/auth/register",
    ]);
    expect(lastBody("/v1/auth/challenge")).toEqual({ purpose: "register", email: "a@b.c" });

    const registerBody = lastBody("/v1/auth/register");
    expect(registerBody).toMatchObject({
      email: "a@b.c",
      password: "password1",
      username: "someone",
      displayName: "Someone",
      pow: { token: "tok", nonce: expect.any(String) },
    });
    // no turnstile token was available -> the field is simply absent
    expect(registerBody.turnstile).toBeUndefined();
    // the edge flag was off, so no credentialed request
    expect(callsTo("/v1/auth/register")[0].init?.credentials).toBeUndefined();
  });

  it("sends the challenge request to the configured api base url", async () => {
    // regression guard: the web test build points at the local mock, and that
    // only works when the challenge is fetched from the same base url
    handler = (call) => {
      if (call.url.endsWith("/v1/auth/challenge")) return json(challenge());
      if (call.url.endsWith("/v1/auth/login")) return json(TOKENS);
      throw new Error(`unexpected ${call.url}`);
    };

    await api.login("a@b.c", "password1");

    expect(callsTo("/v1/auth/challenge")).toHaveLength(1);
    expect(callsTo("/v1/auth/login")).toHaveLength(1);
  });

  it("still works against an api without the challenge endpoint", async () => {
    handler = (call) => {
      if (call.url.endsWith("/v1/auth/challenge")) return json({ message: "nope" }, 404);
      if (call.url.endsWith("/v1/auth/login")) return json(TOKENS);
      throw new Error(`unexpected ${call.url}`);
    };

    await api.login("a@b.c", "password1");

    const loginBody = lastBody("/v1/auth/login");
    expect(loginBody).toEqual({ email: "a@b.c", password: "password1" });
  });

  it("carries the turnstile token and credentials when the server asks for them", async () => {
    const seen: string[] = [];
    setHumanCheckPrompt(async (request) => {
      seen.push(`${request.action}:${request.mode}`);
      return "turnstile-token";
    });
    handler = (call) => {
      if (call.url.endsWith("/v1/auth/challenge"))
        return json(challenge({ turnstile: { mode: "required", edge: true } }));
      if (call.url.endsWith("/v1/auth/register")) return json(TOKENS);
      throw new Error(`unexpected ${call.url}`);
    };

    await api.register("a@b.c", "password1", "someone", "Someone");

    expect(seen).toEqual(["register:required"]);
    expect(lastBody("/v1/auth/register").turnstile).toBe("turnstile-token");
    expect(callsTo("/v1/auth/register")[0].init?.credentials).toBe("include");
  });

  it("asks for a fresh proof when the server reports an expired one", async () => {
    let issued = 0;
    handler = (call) => {
      if (call.url.endsWith("/v1/auth/challenge")) {
        issued += 1;
        return json(challenge({ token: `t${issued}` }));
      }
      if (call.url.endsWith("/v1/auth/login")) {
        // only the second attempt (fresh proof) is accepted
        if (bodyOf(call).pow?.token === "t1") {
          return json({ code: "POW_EXPIRED", message: "expired" }, 400);
        }
        return json(TOKENS);
      }
      throw new Error(`unexpected ${call.url}`);
    };

    const result = await api.login("a@b.c", "password1");
    expect(result.accessToken).toBe("access");

    const loginCalls = callsTo("/v1/auth/login");
    expect(loginCalls).toHaveLength(2);
    expect(bodyOf(loginCalls[0]).pow.token).toBe("t1");
    // the retry grilled a fresh challenge token
    expect(callsTo("/v1/auth/challenge")).toHaveLength(2);
    expect(bodyOf(loginCalls[1]).pow.token).toBe("t2");
  });
});
