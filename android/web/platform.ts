// Small browser-environment adjustments that electron gives the renderer for
// free but an android WebView does not.
import { invoke, send } from "./ipc";

// electron's setWindowOpenHandler: http(s) urls go to the system browser and
// no window is ever opened (window.open returns null)
export function installWindowOpen(): void {
  window.open = function open(url?: string | URL): WindowProxy | null {
    if (url == null) return null;
    let href: string;
    try {
      href = new URL(String(url), window.location.href).href;
    } catch {
      return null;
    }
    if (/^https?:/i.test(href)) send("shell:open-external", href);
    return null;
  };
}

// the async clipboard api is unreliable inside WebView (no permission ui),
// route writes through android's ClipboardManager instead
export function installClipboard(): void {
  const writeText = (text: string): Promise<void> =>
    invoke("clipboard:write-text", String(text ?? "")).then(() => undefined);
  try {
    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, "writeText", { value: writeText, configurable: true });
    } else {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText, readText: () => Promise.reject(new DOMException("Not allowed", "NotAllowedError")) },
        configurable: true,
      });
    }
  } catch {
    // leave the WebView implementation in place
  }
}

// android back button / gesture: behave like the Escape key first (closes the
// top-most dialog, search, right panel or fullscreen player, all of which call
// preventDefault when they consume Escape); the native side falls back to
// WebView history and finally moves the task to the background.
export function handleBackPressed(): boolean {
  const active = document.activeElement as HTMLElement | null;
  const target: EventTarget = active && active !== document.body ? active : document.body || document;
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
    composed: true,
  } as KeyboardEventInit);
  target.dispatchEvent(event);
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true }));
  if (event.defaultPrevented) return true;
  // focused text field: first back press just closes the keyboard
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
    active.blur();
    return true;
  }
  return false;
}

export function installAndroidStyles(isOverlay: boolean): void {
  const style = document.createElement("style");
  style.id = "cloudmusic-android-style";
  style.textContent = [
    "html,body{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;}",
    "html,body{overscroll-behavior:none;}",
    // electron's frameless transparent window has a 4px see-through margin around
    // the app frame; on a phone screen there is nothing behind the window
    isOverlay ? "" : "body{padding:0!important;}",
    "img{-webkit-user-drag:none;}",
  ].join("");
  (document.head || document.documentElement).appendChild(style);
}

// native media focus loss / becoming-noisy are forwarded as the very events the
// renderer already listens to, so its own settings decide what happens
export function dispatchDeviceChange(): void {
  try {
    navigator.mediaDevices?.dispatchEvent(new Event("devicechange"));
  } catch {
    // mediaDevices unavailable
  }
}
