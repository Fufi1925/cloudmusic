// Android replacement for electron's ipcRenderer.
//
// invoke(channel, ...args) -> LinerAndroid.invoke(callId, channel, json) and the
// native side answers asynchronously through window.__linerIpc.reply(...).
// send(channel, ...args)   -> LinerAndroid.send(channel, json), fire and forget.
// native events            -> window.__linerIpc.emit(channel, json) -> on(channel, cb)

export interface NativeBridge {
  invoke(callId: string, channel: string, argsJson: string): void;
  send(channel: string, argsJson: string): void;
  getInfo(): string;
}

type Listener = (payload: any) => void;

interface PendingCall {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

declare global {
  interface Window {
    LinerAndroid?: NativeBridge;
    __linerIpc?: {
      reply: (callId: string, ok: boolean, json: string | null) => void;
      emit: (channel: string, json: string | null) => void;
    };
  }
}

const pending = new Map<string, PendingCall>();
const listeners = new Map<string, Set<Listener>>();
// channels whose events must not get lost when they arrive before the
// renderer subscribed (cold-start deeplinks: electron flushes them on
// did-finish-load, android may deliver them even earlier)
const STICKY_CHANNELS = new Set(["deeplink:open"]);
const stickyQueue = new Map<string, any[]>();
let seq = 0;

function native(): NativeBridge | undefined {
  return typeof window !== "undefined" ? window.LinerAndroid : undefined;
}

function parse(json: string | null | undefined): any {
  if (json == null || json === "") return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function hasNativeBridge(): boolean {
  return Boolean(native());
}

export function invoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
  const bridge = native();
  if (!bridge) return Promise.reject(new Error(`native bridge unavailable (${channel})`));
  const callId = `c${++seq}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    try {
      bridge.invoke(callId, channel, JSON.stringify(args));
    } catch (error) {
      pending.delete(callId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function send(channel: string, ...args: unknown[]): void {
  const bridge = native();
  if (!bridge) return;
  try {
    bridge.send(channel, JSON.stringify(args));
  } catch {
    // ipcRenderer.send never throws into the renderer either
  }
}

export function on(channel: string, cb: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(cb);
  const queued = stickyQueue.get(channel);
  if (queued && queued.length > 0) {
    stickyQueue.delete(channel);
    // deliver async like a real ipc message would arrive
    setTimeout(() => {
      for (const payload of queued) {
        try {
          cb(payload);
        } catch (error) {
          console.error(`[ipc] listener for ${channel} failed`, error);
        }
      }
    }, 0);
  }
  return () => {
    listeners.get(channel)?.delete(cb);
  };
}

export function dispatch(channel: string, payload: any): void {
  const set = listeners.get(channel);
  if (!set || set.size === 0) {
    if (STICKY_CHANNELS.has(channel)) {
      const queue = stickyQueue.get(channel) ?? [];
      queue.push(payload);
      stickyQueue.set(channel, queue.slice(-5));
    }
    return;
  }
  for (const cb of Array.from(set)) {
    try {
      cb(payload);
    } catch (error) {
      console.error(`[ipc] listener for ${channel} failed`, error);
    }
  }
}

export function installIpcReceiver(onEvent?: (channel: string, payload: any) => boolean): void {
  window.__linerIpc = {
    reply(callId, ok, json) {
      const call = pending.get(callId);
      if (!call) return;
      pending.delete(callId);
      const value = parse(json);
      if (ok) {
        call.resolve(value);
      } else {
        const message =
          value && typeof value === "object" && typeof value.message === "string"
            ? value.message
            : typeof value === "string"
              ? value
              : "native call failed";
        call.reject(new Error(message));
      }
    },
    emit(channel, json) {
      const payload = parse(json);
      // internal channels (viewport, back button, ...) are consumed by the shim itself
      if (onEvent?.(channel, payload)) return;
      dispatch(channel, payload);
    },
  };
}
