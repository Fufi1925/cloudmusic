import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyClient, deriveLobbyUrl, normalizeLobbyUrl } from "./lobbyClient";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  /** test helper: pretend the server pushed a message */
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
});

afterEach(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  vi.useRealTimers();
});

describe("lobby url helpers", () => {
  it("derives a wss url from the api base", () => {
    expect(deriveLobbyUrl("https://api.tryliner.fun")).toBe("wss://api.tryliner.fun/v1/lobby/ws");
  });

  it("accepts a bare host for a self hosted server", () => {
    expect(normalizeLobbyUrl("localhost:4300")).toBe("ws://localhost:4300/v1/lobby/ws");
  });

  it("keeps an explicit websocket path", () => {
    expect(normalizeLobbyUrl("ws://192.168.0.10:4300/v1/lobby/ws")).toBe("ws://192.168.0.10:4300/v1/lobby/ws");
  });

  it("appends the default path to a websocket url without one", () => {
    expect(normalizeLobbyUrl("wss://lobby.example.com")).toBe("wss://lobby.example.com/v1/lobby/ws");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeLobbyUrl("   ")).toBe("");
  });
});

describe("LobbyClient", () => {
  it("sends the identity handshake as soon as the socket opens", async () => {
    const client = new LobbyClient("ws://test/v1/lobby/ws");
    client.start();
    await Promise.resolve();
    await Promise.resolve();

    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe("ws://test/v1/lobby/ws");
    const hello = JSON.parse(socket.sent[0]);
    expect(hello.type).toBe("hello");
    expect(typeof hello.userId).toBe("string");
    client.stop();
  });

  it("queues a join request until the socket is ready", async () => {
    const client = new LobbyClient("ws://test/v1/lobby/ws");
    client.send({ type: "join_request", code: "4821" });
    await Promise.resolve();
    await Promise.resolve();

    const socket = MockWebSocket.instances[0];
    const types = socket.sent.map((raw) => JSON.parse(raw).type);
    expect(types).toContain("hello");
    expect(types).toContain("join_request");
    client.stop();
  });

  it("drops stale playback updates instead of replaying them", async () => {
    const client = new LobbyClient("ws://test/v1/lobby/ws");
    client.send({ type: "playback", track: null, queue: [], index: 0, positionMs: 0, status: "paused" });
    await Promise.resolve();
    await Promise.resolve();

    const socket = MockWebSocket.instances[0];
    expect(socket.sent.some((raw) => JSON.parse(raw).type === "playback")).toBe(false);
    client.stop();
  });

  it("forwards server messages to subscribers", async () => {
    const client = new LobbyClient("ws://test/v1/lobby/ws");
    const received: string[] = [];
    client.onMessage((message) => received.push(message.type));
    client.start();
    await Promise.resolve();
    await Promise.resolve();

    MockWebSocket.instances[0].emit({ type: "join_pending", code: "4821" });
    expect(received).toContain("join_pending");
    client.stop();
  });

  it("measures the clock offset from ping samples", async () => {
    const client = new LobbyClient("ws://test/v1/lobby/ws");
    client.start();
    await Promise.resolve();
    await Promise.resolve();

    const socket = MockWebSocket.instances[0];
    const ping = socket.sent.map((raw) => JSON.parse(raw)).find((message) => message.type === "ping");
    expect(ping).toBeTruthy();

    // server clock runs 5 s ahead of ours
    socket.emit({ type: "pong", t0: ping.t0, t1: ping.t0 + 5_000 + Math.round((Date.now() - ping.t0) / 2) });
    expect(client.getOffsetMs()).toBeGreaterThan(4_500);
    expect(client.getOffsetMs()).toBeLessThan(5_500);
    client.stop();
  });

  it("resumes after a reconnect", async () => {
    const client = new LobbyClient("ws://test/v1/lobby/ws");
    const onReconnect = vi.fn();
    client.onReconnect = onReconnect; // replaced by the sync layer in the app
    client.start();
    await Promise.resolve();
    await Promise.resolve();

    const first = MockWebSocket.instances[0];
    first.readyState = MockWebSocket.CLOSED;
    first.onclose?.();
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    await Promise.resolve();

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    expect(onReconnect).toHaveBeenCalled();
    client.stop();
  });
});
