// The renderer is responsive: below 768px it switches to the portrait layout
// (bottom navigation, stacked page headers, full screen sheets), above it the
// desktop layout is used unchanged.
//
// On android the WebView therefore gets the real screen size in dp as the css
// viewport (no more shrinking the 1100x705 desktop canvas onto a phone), and
// the user's pinch-to-zoom only scales that viewport: a pinch factor > 1
// zooms in (fewer css pixels), < 1 zooms out.
//
// The native side reports the usable screen size in dp (system bars / display
// cutout removed, the soft keyboard intentionally NOT removed so typing never
// re-zooms the layout) plus the user's pinch factor.

export const DESKTOP_MIN_WIDTH = 1100;
export const DESKTOP_MIN_HEIGHT = 705;
/** smallest css canvas we ever hand to the renderer */
export const MIN_VIEWPORT_WIDTH = 320;
export const MIN_VIEWPORT_HEIGHT = 480;
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;
/** legacy export kept for the native "maxUiScale" round trip */
export const HARD_MIN_WIDTH = MIN_VIEWPORT_WIDTH;
export const HARD_MIN_HEIGHT = MIN_VIEWPORT_HEIGHT;
export const PHONE_SCALE_FLOOR = MIN_SCALE;
export const TABLET_SCALE_FLOOR = MIN_SCALE;

export interface ViewportMetrics {
  wDp: number;
  hDp: number;
  phone: boolean;
  uiScale: number;
}

export interface ComputedViewport {
  width: number;
  height: number;
  scale: number;
  /** automatic scale before the user's pinch factor (always 1 now) */
  base: number;
  /** largest pinch factor that keeps the css canvas above the minimum size */
  maxUiScale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeViewport(metrics: ViewportMetrics): ComputedViewport {
  const wDp = Math.max(1, metrics.wDp || window.innerWidth || 360);
  const hDp = Math.max(1, metrics.hDp || window.innerHeight || 640);
  const userScale = Number.isFinite(metrics.uiScale) && metrics.uiScale > 0 ? metrics.uiScale : 1;

  // the css canvas shrinks when zooming in, grows when zooming out
  const widthLimitScale = wDp / MIN_VIEWPORT_WIDTH;
  const heightLimitScale = hDp / MIN_VIEWPORT_HEIGHT;
  const maxUiScale = Math.max(1, Math.min(MAX_SCALE, widthLimitScale, heightLimitScale));
  const scale = Math.round(clamp(userScale, MIN_SCALE, maxUiScale) * 10000) / 10000;

  return {
    width: Math.max(MIN_VIEWPORT_WIDTH, Math.round(wDp / scale)),
    height: Math.max(MIN_VIEWPORT_HEIGHT, Math.round(hDp / scale)),
    scale,
    base: 1,
    maxUiScale: Math.round(maxUiScale * 100) / 100,
  };
}

let meta: HTMLMetaElement | null = null;
let last: ComputedViewport | null = null;
let overlayMode = false;

function ensureMeta(): HTMLMetaElement {
  if (meta && meta.isConnected) return meta;
  for (const existing of Array.from(document.querySelectorAll('meta[name="viewport"]'))) {
    existing.remove();
  }
  meta = document.createElement("meta");
  meta.name = "viewport";
  (document.head || document.documentElement).appendChild(meta);
  return meta;
}

export function applyViewport(metrics: ViewportMetrics): ComputedViewport | null {
  const el = ensureMeta();
  if (overlayMode) {
    // the overlay window is laid out 1:1 like electron's 320x56 overlay window
    el.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no");
    return null;
  }
  const next = computeViewport(metrics);
  if (last && last.width === next.width && last.scale === next.scale && last.maxUiScale === next.maxUiScale) return last;
  last = next;
  el.setAttribute(
    "content",
    `width=${next.width}, initial-scale=${next.scale}, minimum-scale=${next.scale}, maximum-scale=${next.scale}, user-scalable=no, viewport-fit=cover`,
  );
  document.documentElement.style.setProperty("--cloudmusic-android-scale", String(next.scale));
  return next;
}

export function installViewport(metrics: ViewportMetrics, isOverlay: boolean): void {
  overlayMode = isOverlay;
  applyViewport(metrics);
}

export function getLastViewport(): ComputedViewport | null {
  return last;
}
