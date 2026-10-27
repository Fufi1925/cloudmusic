import { getAuthSession } from "../api/auth-session";
import { getApiBaseUrl } from "../api/baseUrl";
import { APP_VERSION } from "../config/version";
import type { LobbyClientMessage, LobbyServerMessage } from "./types";

const INITIAL_RECONNECT_DELAY_MS = 1_500;
const MAX_RECONNECT_DELAY_MS = 20_000;
const PING_INTERVAL_MS = 20_000;
const URL_STORAGE_KEY = "cloudmusic_lobby_url";

/** `https://api.example.com` → `wss://api.example.com/v1/lobby/ws` */
export function deriveLobbyUrl(apiBase: string): string {
  const clean = apiBase.trim().replace(/\/+$/, "");
  if (!clean) return "";
  const secure = clean.startsWith("https");
  const host = clean.replace(/^https?:\/\//, "");
  // a bare host (or host:port) is used as-is so a self-hosted server works too
  if (/^[^/]+$/.test(host) && !host.includes("/")) {
    return `${secure ? "wss" : "ws"}://${host}/v1/lobby/ws`;
  }
  return `${secure ? "wss" : "ws"}://${host}/v1/lobby/ws`;
}

/** accept either a bare `host:port`, a ws:// url or a full path */
export function normalizeLobbyUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^wss?:\/\//i.test(value)) {
    return value.replace(/\/+$/, "").includes("/v1/") ? value.replace(/\/+$/, "") : `${value.replace(/\/+$/, "")}/v1/lobby/ws`;
  }
  if (/^https?:\/\//i.test(value)) return deriveLobbyUrl(value);
  return deriveLobbyUrl(`http://${value.replace(/^\/+/, "")}`);
}

export function getStoredLobbyUrl(): string | null {
  try {
    return localStorage.getItem(URL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLobbyUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(URL_STORAGE_KEY, url.trim());
    else localStorage.removeItem(URL_STORAGE_KEY);
  } catch {
    /* private mode / quota – the in-memory default still works */
  }
}

export function getDefaultLobbyUrl(): string {
  const stored = getStoredLobbyUrl();
  if (stored) return normalizeLobbyUrl(stored);
  return deriveLobbyUrl(getApiBaseUrl());
}

type Listener = (message: LobbyServerMessage) => void;
type StateListener = (status: "connecting" | "connected" | "closed") => void;

/**
 * Thin, reconnecting WebSocket wrapper for the lobby protocol.
 *
 * It does three things: keeps one socket alive, replays the handshake identity
 * after a reconnect (or hands it to `onReconnect` so the caller can resume its
 * lobby) and measures the clock offset to the server so playback positions can
 * be extrapolated.
 */
export class LobbyClient {
  private ws: WebSocket | null = null;
  private url = "";
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private outbox: LobbyClientMessage[] = [];
  private offsetMs = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  private running = false;
  private connecting = false;
  private hasConnectedOnce = false;

  /** called after a reconnect (not the first connect) so the caller can resume */
  onReconnect: (() => void) | null = null;

  constructor(url?: string) {
    this.url = url ?? "";
  }

  getUrl(): string {
    return this.url;
  }

  setUrl(url: string): void {
    const next = url.trim();
    if (next === this.url) return;
    this.url = next;
    if (this.running) {
      this.closeSocket();
      this.scheduleReconnect(0);
    }
  }

  getOffsetMs(): number {
    return this.offsetMs;
  }

  getRttMs(): number {
    return Number.isFinite(this.bestRtt) ? this.bestRtt : 0;
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  start(url?: string): void {
    if (url) this.url = url;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.connecting = false;
    this.hasConnectedOnce = false;
    this.clearTimers();
    this.closeSocket();
    this.outbox = [];
  }

  /** queue-friendly send: replayable messages wait for the next open socket */
  send(message: LobbyClientMessage): void {
    if (this.isConnected()) {
      this.write(message);
      return;
    }
    // playback updates are worthless once the socket is back; everything
    // else (join/create/vote) must survive a short hiccup
    if (message.type !== "playback") this.outbox.push(message);
    // wanting to send something implies wanting a connection
    this.running = true;
    void this.connect();
  }

  /** current server time estimate in ms */
  serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  private write(message: LobbyClientMessage): void {
    try {
      this.ws?.send(JSON.stringify(message));
    } catch {
      this.scheduleReconnect(0);
    }
  }

  private emitState(status: "connecting" | "connected" | "closed"): void {
    for (const listener of this.stateListeners) listener(status);
  }

  private identity(): { userId: string; name: string } {
    const user = getAuthSession()?.user;
    return {
      userId: user?.id ?? "anonymous",
      name: user?.displayName || user?.username || user?.email?.split("@")[0] || "Hörer",
    };
  }

  private connect(): Promise<void> {
    if (!this.running || this.connecting) return Promise.resolve();
    if (typeof WebSocket === "undefined" || !this.url) return Promise.resolve();
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return Promise.resolve();
    }

    this.connecting = true;
    this.emitState("connecting");

    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        this.connecting = false;
        this.emitState("closed");
        this.scheduleReconnect();
        resolve();
        return;
      }
      this.ws = socket;

      socket.onopen = () => {
        this.connecting = false;
        this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
        if (this.ws !== socket) return;
        this.emitState("connected");

        const { userId, name } = this.identity();
        this.write({ type: "hello", userId, name, clientVersion: APP_VERSION });

        const replay = [...this.outbox];
        this.outbox = [];
        for (const message of replay) this.write(message);

        if (this.hasConnectedOnce) this.onReconnect?.();
        this.hasConnectedOnce = true;

        this.startPing();
        resolve();
      };

      socket.onmessage = (event) => {
        let message: LobbyServerMessage;
        try {
          message = JSON.parse(String(event.data)) as LobbyServerMessage;
        } catch {
          return;
        }
        if (message.type === "pong") this.applyPong(message.t0, message.t1);
        for (const listener of this.listeners) listener(message);
      };

      socket.onclose = () => {
        this.connecting = false;
        if (this.ws !== socket) return;
        this.ws = null;
        this.stopPing();
        this.emitState("closed");
        this.scheduleReconnect();
        resolve();
      };

      socket.onerror = () => {
        this.connecting = false;
        if (this.ws !== socket) return;
        this.closeSocket();
        this.emitState("closed");
        this.scheduleReconnect();
        resolve();
      };
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingSample();
    this.pingTimer = setInterval(() => this.pingSample(), PING_INTERVAL_MS);
  }

  private pingSample(): void {
    if (!this.isConnected()) return;
    this.write({ type: "ping", t0: Date.now() });
  }

  /** keep the sample with the smallest round trip – least noise in the offset */
  private applyPong(t0: number, serverTime: number): void {
    const now = Date.now();
    const rtt = now - t0;
    const offset = serverTime - (t0 + rtt / 2);
    if (rtt <= this.bestRtt) {
      this.bestRtt = rtt;
      this.offsetMs = offset;
    } else {
      // decay the stored best so a moved server clock is picked up eventually
      this.bestRtt = this.bestRtt * 0.98 + rtt * 0.02;
      this.offsetMs = this.offsetMs * 0.9 + offset * 0.1;
    }
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }

  private scheduleReconnect(delay?: number): void {
    if (!this.running || this.reconnectTimer) return;
    const wait = delay ?? this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, MAX_RECONNECT_DELAY_MS);
    this.emitState("closed");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, wait);
  }
}

export const lobbyClient = new LobbyClient(getDefaultLobbyUrl());
