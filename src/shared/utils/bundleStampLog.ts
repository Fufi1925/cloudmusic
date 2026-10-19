import { log } from "./logger";

export function initBundleStampLog(): () => void {
  if (typeof window === "undefined") return () => {};
  return window.cloudMusicElectron?.onBundleStamp?.((line) => log("gray", "bundle", line)) ?? (() => {});
}
