// cloudmusic-android.js: loaded as a classic <script> before the renderer's module
// bundle, i.e. this is what electron/preload.ts is for the desktop app.
import { parseDeeplink } from "../../electron/deeplink";
import { dispatch, installIpcReceiver, send } from "./ipc";
import { installFetchProxy } from "./netPatch";
import { createCloudMusicApi, type AndroidInfo } from "./api";
import { applyViewport, getLastViewport, installViewport, type ViewportMetrics } from "./viewport";
import {
  dispatchDeviceChange,
  handleBackPressed,
  installAndroidStyles,
  installClipboard,
  installWindowOpen,
} from "./platform";
import { getWasmExports } from "./signer";

declare global {
  interface Window {
    __cloudMusicAndroid?: {
      info: AndroidInfo;
      back: () => boolean;
    };
  }
}

function readInfo(): AndroidInfo | null {
  try {
    return JSON.parse(window.CloudMusicAndroid!.getInfo()) as AndroidInfo;
  } catch (error) {
    console.error("[cloudmusic-android] could not read native info", error);
    return null;
  }
}

(function install() {
  if (typeof window === "undefined" || window.__cloudMusicAndroid) return;
  if (!window.CloudMusicAndroid) {
    console.warn("[cloudmusic-android] native bridge missing, running as plain web app");
    return;
  }
  const info = readInfo();
  if (!info) return;

  const isOverlay = info.role === "overlay" || window.location.hash.startsWith("#/overlay");
  let metrics: ViewportMetrics = {
    wDp: info.viewport?.wDp ?? 0,
    hDp: info.viewport?.hDp ?? 0,
    phone: info.phone,
    uiScale: info.uiScale ?? 1,
  };

  installIpcReceiver((channel, payload) => {
    switch (channel) {
      case "android:viewport": {
        metrics = { ...metrics, ...payload };
        const applied = applyViewport(metrics);
        if (applied) send("android:viewport-applied", applied);
        return true;
      }
      case "android:deeplink": {
        // same strict parser electron/main.ts runs before forwarding
        const target = typeof payload === "string" ? parseDeeplink(payload) : null;
        if (target) dispatch("deeplink:open", target);
        return true;
      }
      case "android:devicechange":
        dispatchDeviceChange();
        return true;
      default:
        return false;
    }
  });

  installFetchProxy();
  installViewport(metrics, isOverlay);
  const initialViewport = getLastViewport();
  if (initialViewport) send("android:viewport-applied", initialViewport);
  installAndroidStyles(isOverlay);
  installClipboard();
  installWindowOpen();

  window.cloudMusicElectron = createCloudMusicApi(info);
  window.__cloudMusicAndroid = { info, back: handleBackPressed };

  // compile the signer right away, the first api request needs it
  void getWasmExports().catch((error) => console.error("[signer] wasm init failed", error));

  send("android:ready", { role: isOverlay ? "overlay" : "main" });
})();
