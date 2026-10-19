// The renderer is a fixed desktop layout (electron enforces a 1100x705 minimum
// window). On android the layout keeps that exact design and the WebView is
// zoomed so it fits the screen: the css viewport is enlarged (`width=` in the
// viewport meta) and scaled down by the same factor. The native side reports
// the usable screen size in dp (system bars / display cutout removed, the soft
// keyboard intentionally NOT removed so typing never re-zooms the layout) plus
// the user's pinch-to-zoom ui scale.

export const DESKTOP_MIN_WIDTH = 1100;
export const DESKTOP_MIN_HEIGHT = 705;
// lower bound of the automatic fit so text stays readable on phones; below it
// the layout gets a bit less room than the desktop minimum (still fully usable)
export const PHONE_SCALE_FLOOR = 0.68;
export const TABLET_SCALE_FLOOR = 0.7;
// pinch-to-zoom never shrinks the css canvas below this: sidebar + content +
// player bar and the fullscreen player stop fitting underneath it
export const HARD_MIN_WIDTH = 960;
export const HARD_MIN_HEIGHT = 470;
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 2;

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
  /** automatic scale before the user's pinch factor */
  base: number;
  /** largest pinch factor that still respects HARD_MIN_WIDTH / HARD_MIN_HEIGHT */
  maxUiScale: number;
}

export function computeViewport(metrics: ViewportMetrics): ComputedViewport {
  const wDp = Math.max(1, metrics.wDp || window.innerWidth || DESKTOP_MIN_WIDTH);
  const hDp = Math.max(1, metrics.hDp || window.innerHeight || DESKTOP_MIN_HEIGHT);
  const fit = Math.min(1, wDp / DESKTOP_MIN_WIDTH, hDp / DESKTOP_MIN_HEIGHT);
  const floor = metrics.phone ? PHONE_SCALE_FLOOR : TABLET_SCALE_FLOOR;
  const ceiling = Math.max(fit, Math.min(wDp / HARD_MIN_WIDTH, hDp / HARD_MIN_HEIGHT));
  const base = Math.min(Math.max(fit, floor), ceiling);
  const userScale = Number.isFinite(metrics.uiScale) && metrics.uiScale > 0 ? metrics.uiScale : 1;
  const raw = Math.min(base * userScale, Math.max(base, ceiling));
  const scale = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)) * 10000) / 10000;
  return {
    width: Math.max(320, Math.round(wDp / scale)),
    height: Math.max(240, Math.round(hDp / scale)),
    scale,
    base,
    maxUiScale: Math.max(1, Math.round((Math.max(base, ceiling) / base) * 100) / 100),
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
