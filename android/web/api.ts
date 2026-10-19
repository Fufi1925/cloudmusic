// Android implementation of the exact `LinerElectronApi` contract from
// electron/preload.ts. Channel names are kept 1:1 with the electron ipc
// channels so the native dispatcher (LinerBridge.java) reads like main.ts.
import type { DeeplinkTarget, LinerElectronApi, WindowState } from "../../electron/preload";
import type { MainNetResult } from "../../electron/netdiag";
import { invoke, on, send } from "./ipc";
import * as signer from "./signer";

export interface AndroidInfo {
  platform: string;
  role: "main" | "overlay";
  appVersion: string;
  sdkInt: number;
  phone: boolean;
  viewport: { wDp: number; hDp: number };
  uiScale: number;
  model?: string;
}

type AnyCb = (payload: any) => void;

function subscribe(channel: string, cb: AnyCb): () => void {
  return on(channel, cb);
}

// --- touchbar:update-state -> android media session ------------------------
// The renderer pushes the full touch bar payload (incl. all synced lyric lines)
// up to 4x per second. The native media session only needs the playback core,
// so it is trimmed and position-only updates are rate limited (the system ui
// extrapolates the position from position + playback speed itself).
interface MediaCore {
  status: string;
  track: { id?: string; title: string; artist: string; album?: string; cover?: string | null; durationMs?: number } | null;
  positionMs: number;
  durationMs: number;
  isLiked: boolean;
  shuffle: boolean;
  repeat: string;
  playbackRate: number;
}

let lastMediaKey = "";
let lastMediaSentAt = 0;
let lastMediaPosition = 0;
let lastMediaRate = 1;
let lastMediaPlaying = false;

function currentPlaybackRate(): number {
  const audio = document.getElementById("liner-audio") as HTMLAudioElement | null;
  const rate = audio?.playbackRate;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function pushMediaState(state: any): void {
  if (!state || typeof state !== "object") return;
  const core: MediaCore = {
    status: String(state.status ?? "idle"),
    track: state.track
      ? {
          id: state.track.id,
          title: String(state.track.title ?? ""),
          artist: String(state.track.artist ?? ""),
          album: state.track.album ? String(state.track.album) : "",
          cover: state.track.cover ?? null,
          durationMs: Number(state.track.durationMs) || 0,
        }
      : null,
    positionMs: Math.max(0, Math.round(Number(state.positionMs) || 0)),
    durationMs: Math.max(0, Math.round(Number(state.durationMs) || 0)),
    isLiked: Boolean(state.isLiked),
    shuffle: Boolean(state.shuffle),
    repeat: String(state.repeat ?? "off"),
    playbackRate: currentPlaybackRate(),
  };
  const key = JSON.stringify([
    core.status,
    core.track?.id,
    core.track?.title,
    core.track?.artist,
    core.track?.cover,
    core.durationMs,
    core.isLiked,
    core.shuffle,
    core.repeat,
    core.playbackRate,
  ]);
  const now = Date.now();
  const expected = lastMediaPlaying ? lastMediaPosition + (now - lastMediaSentAt) * lastMediaRate : lastMediaPosition;
  const jumped = Math.abs(core.positionMs - expected) > 1500;
  if (key === lastMediaKey && !jumped && now - lastMediaSentAt < 15000) return;
  lastMediaKey = key;
  lastMediaSentAt = now;
  lastMediaPosition = core.positionMs;
  lastMediaRate = core.playbackRate;
  lastMediaPlaying = core.status === "playing";
  send("touchbar:update-state", core);
}

// --- storage helpers that live on the web side on android ------------------
async function clearCacheStorage(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // cache storage unavailable
  }
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations ?? []).map((reg) => reg.unregister()));
  } catch {
    // no service workers
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = done;
      req.onerror = done;
      // a still-open connection blocks the delete; electron's clearStorageData
      // force-closes them, here we just stop waiting
      req.onblocked = () => setTimeout(done, 1500);
    } catch {
      done();
    }
    setTimeout(done, 4000);
  });
}

async function clearAllIndexedDb(): Promise<void> {
  try {
    const dbs = (await (indexedDB as any).databases?.()) as Array<{ name?: string }> | undefined;
    await Promise.all((dbs ?? []).filter((db) => db.name).map((db) => deleteDatabase(db.name!)));
  } catch {
    // indexedDB.databases() unsupported
  }
}

export function createLinerApi(info: AndroidInfo): LinerElectronApi {
  const appVersion = info.appVersion;

  const api: LinerElectronApi = {
    platform: info.platform || "android",
    isHyprland: false,

    // window controls (android: minimize = move task to back, maximize = immersive fullscreen)
    minimize: () => invoke("window:minimize"),
    toggleMaximize: () => invoke("window:toggle-maximize"),
    toggleFullScreen: () => invoke("window:toggle-fullscreen"),
    close: () => invoke("window:close"),
    isMaximized: () => invoke<boolean>("window:is-maximized"),
    isFullScreen: () => invoke<boolean>("window:is-fullscreen"),
    onWindowStateChange: (cb: (state: WindowState) => void) => subscribe("window:state-changed", cb),
    onWindowRestored: (cb: () => void) => subscribe("window:restored", () => cb()),
    onWindowMinimized: (cb: () => void) => subscribe("window:minimized", () => cb()),
    // there are no movable windows on android
    dragStart: () => undefined,
    dragMove: () => undefined,
    dragEnd: () => undefined,

    // embedded wasm signer, same module + error contract as electron main
    signRequest: async (input) => {
      try {
        return await signer.signRequest(input);
      } catch (err: any) {
        console.error("[signer] signRequest error:", err);
        return { error: String(err?.message || err) };
      }
    },
    signMonitorRequest: async (input) => {
      try {
        return await signer.signMonitorRequest(input);
      } catch (err: any) {
        console.error("[signer] signMonitorRequest error:", err);
        return { error: String(err?.message || err) };
      }
    },
    syncServerTime: async (dateHeaderOrMs) => {
      try {
        return signer.syncServerTime(dateHeaderOrMs);
      } catch {
        return 0;
      }
    },
    getServerTimeOffset: async () => signer.getServerTimeOffset(),
    signCoverUrl: async (payload) => {
      try {
        return await signer.signCoverUrl(payload);
      } catch (err) {
        console.error("[signer] signCoverUrl error:", err);
        return payload;
      }
    },
    signRawPayload: async (payload) => {
      try {
        return await signer.signRawPayload(payload);
      } catch (err) {
        console.error("[signer] signRawPayload error:", err);
        return "";
      }
    },

    onDeeplink: (cb: (target: DeeplinkTarget) => void) => subscribe("deeplink:open", cb),
    diagnoseNetwork: (hosts: string[]) => invoke<MainNetResult>("net:diagnose", hosts),
    openDownloads: (customPath?: string) => invoke<boolean>("shell:open-downloads", customPath ?? null),
    openExportFolder: (customPath?: string) => invoke<boolean>("shell:open-export-folder", customPath ?? null),
    saveDump: (input) => invoke("dialog:save-dump", input),
    setAppIcon: (dataUrl, options) => invoke("app:set-icon", dataUrl, options ?? null),
    getAppVersion: async () => appVersion,

    getCacheStats: () => invoke("storage:get-cache-stats"),
    openCacheFolder: () => invoke<boolean>("shell:open-cache-folder"),
    clearCoversCache: async () => {
      await clearCacheStorage();
      return invoke<boolean>("storage:clear-covers-cache");
    },
    clearAudioCache: async (clearEntireDb?: boolean) => {
      if (clearEntireDb) await clearAllIndexedDb();
      return invoke<boolean>("storage:clear-audio-cache", Boolean(clearEntireDb));
    },
    clearHttpCache: () => invoke<boolean>("storage:clear-http-cache"),

    // electron-updater ships desktop installers from github releases; there is
    // no android artifact to update to, so the updater reports "up to date"
    checkForUpdates: async () => ({ available: false }),
    downloadUpdate: async () => ({ success: false, error: "Updates are not available on Android" }),
    quitAndInstall: async () => false,
    onUpdateAvailable: (cb) => subscribe("updater:update-available", cb),
    onUpdateDownloadProgress: (cb) => subscribe("updater:download-progress", cb),
    onUpdateDownloaded: (cb) => subscribe("updater:update-downloaded", cb),
    onUpdateError: (cb) => subscribe("updater:error", cb),

    // OTA frontend bundles are built for the electron shell (no android bridge
    // inside), so the android build always runs its packaged bundle
    bundleCheck: async () => ({ available: false, reason: "android" }),
    bundleDownloadAndInstall: async () => ({ success: false, error: "OTA bundles are not available on Android" }),
    bundleHotSwap: async () => false,
    bundleRollback: async () => false,
    bundleGetStatus: async () => ({
      appVersion,
      bundleVersion: appVersion,
      isOta: false,
      sha256: null,
      effectivePath: "file:///android_asset/www/index.html",
    }),
    onBundleAvailable: (cb) => subscribe("bundle:available", cb),
    onBundleDownloadProgress: (cb) => subscribe("bundle:download-progress", cb),
    onBundleReady: (cb) => subscribe("bundle:ready", cb),
    onBundleStamp: (cb) => subscribe("bundle:stamp", cb),

    // macOS touch bar -> android media session / notification / lock screen
    touchbarUpdateState: (state) => pushMediaState(state),
    onTouchBarAction: (cb) => subscribe("touchbar:action", cb),
    sendTouchBarAction: (action) => send("touchbar:send-action", action),
    getTouchBarInitialState: async () => null,
    onTouchBarRequestSync: (cb) =>
      subscribe("touchbar:request-sync", () => {
        lastMediaKey = "";
        cb();
      }),

    // overlay -> floating android window ("display over other apps")
    overlayUpdateState: (state) => send("overlay:update-state", state),
    onOverlayAction: (cb) => subscribe("overlay:action", cb),
    sendOverlayAction: (action) => send("overlay:send-action", action),
    toggleOverlay: () => invoke<boolean>("overlay:toggle"),
    isOverlayOpen: () => invoke<boolean>("overlay:is-open"),
    closeOverlay: () => send("overlay:close"),
    onOverlayState: (cb) => subscribe("overlay:state", cb),
    getOverlayInitialState: () => invoke("overlay:get-initial-state"),
    updateOverlaySettings: (settings) => send("overlay:update-settings", settings),
    pauseOverlayShortcuts: (paused) => send("overlay:pause-shortcuts", Boolean(paused)),
    onOverlaySettingsChanged: (cb) => subscribe("overlay:settings-changed", cb),
    onOverlayVisibility: (cb) => subscribe("overlay:visibility", cb),
    setOverlayAuthenticated: (authenticated) => send("overlay:set-authenticated", Boolean(authenticated)),

    // discord rich presence talks to the local discord desktop ipc socket,
    // which does not exist on android
    discordUpdateState: () => undefined,
    discordUpdateSettings: () => undefined,
    getDiscordStatus: async () => ({ connected: false }),

    mintPoToken: (identifier: string) => invoke<string>("potoken:mint", identifier),
  };

  return api;
}
