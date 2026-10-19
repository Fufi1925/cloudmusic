import { useSyncExternalStore } from "react";

/**
 * Compact (portrait phone) layout breakpoint. The electron window never gets
 * narrower than 1100px, so this only ever becomes true inside the android
 * WebView (or a browser window dragged narrow), where the portrait UI takes
 * over: bottom navigation instead of the sidebar, stacked page headers,
 * full-screen sheets instead of floating panels.
 */
export const COMPACT_MAX_WIDTH = 767;

const QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;

let mediaQuery: MediaQueryList | null = null;

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  if (!mediaQuery || !mediaQuery.addEventListener) {
    mediaQuery = window.matchMedia(QUERY);
  }
  return mediaQuery;
}

function subscribe(onChange: () => void): () => void {
  const mq = getMediaQuery();
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  const mq = getMediaQuery();
  return mq ? mq.matches : false;
}

/** true when the app renders the portrait / phone layout */
export function useIsCompact(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** non-reactive variant for event handlers */
export function isCompactLayout(): boolean {
  return getSnapshot();
}
