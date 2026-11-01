import { useEffect, useRef } from "react";
import {
  humanCheckOrigin,
  humanCheckPageUrl,
  type HumanCheckAction,
} from "@/shared/api/humanCheck";
import { recordAuthStep } from "@/shared/api/authDiagnostics";
import { useHumanCheckStore } from "../store/humanCheckStore";

interface CheckMessage {
  source?: string;
  action?: string;
  type?: "token" | "error" | "expired";
  token?: string;
  code?: string;
}

export interface CheckFrameProps {
  action: HumanCheckAction;
  attempt: number;
}

/** how long one widget attempt may take before it counts as stuck */
const STUCK_AFTER_MS = 15_000;

/**
 * The api's own turnstile page in an iframe. It posts the token back to us
 * (same protocol as upstream): `{source:"liner-turnstile", action, type, token}`.
 */
export default function CheckFrame({ action, attempt }: CheckFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const phase = useHumanCheckStore((state) => state.phase);
  const setPhase = useHumanCheckStore((state) => state.setPhase);
  const solve = useHumanCheckStore((state) => state.solve);
  const fail = useHumanCheckStore((state) => state.fail);
  const ready = phase !== "loading";

  useEffect(() => {
    const origin = humanCheckOrigin();
    const onMessage = (event: MessageEvent) => {
      const data = event.data as CheckMessage | undefined;
      if (!data || typeof data !== "object" || data.source !== "liner-turnstile") return;

      // note anything the page sends, even when we cannot use it: "widget failed"
      // and "we filtered the token out" look identical without this line
      const sameWindow = event.source === frameRef.current?.contentWindow;
      if (event.origin !== origin || !sameWindow) {
        recordAuthStep(
          "check ignored",
          `origin=${event.origin || "?"} expected=${origin || "?"} window=${sameWindow ? "same" : "other"}`,
        );
        return;
      }
      if (data.action && data.action !== action) {
        recordAuthStep("check action mismatch", `${data.action} != ${action}`);
        return;
      }
      if (data.type === "token" && data.token) {
        recordAuthStep("check token", `${data.token.length} chars`);
        solve(data.token);
      } else if (data.type === "expired") {
        recordAuthStep("check expired", data.code ?? "");
        fail("expired", "expired");
      } else if (data.type === "error") {
        recordAuthStep("check error", data.code ?? "");
        fail("error", data.code || "error");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [action, setPhase, solve, fail]);

  // no token after a while: stop pretending to load instead of spinning forever
  useEffect(() => {
    const timer = setTimeout(() => {
      const state = useHumanCheckStore.getState();
      if (!state.request) return;
      recordAuthStep("check timeout", `no token after ${Math.round(STUCK_AFTER_MS / 1000)}s`);
      state.fail("timeout", "timeout");
    }, STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [attempt]);

  const markLoaded = () => {
    recordAuthStep("check loaded", "");
    if (useHumanCheckStore.getState().phase === "loading") setPhase("ready");
  };

  return (
    <div className="relative mx-auto h-[88px] w-full max-w-[320px] shrink-0">
      <div
        className={`pointer-events-none absolute inset-x-[10px] top-[11px] h-[65px] rounded-[10px] bg-black/[0.08] transition-opacity duration-300 dark:bg-white/[0.1] ${
          ready ? "opacity-0" : "animate-pulse"
        }`}
      />
      <iframe
        key={attempt}
        ref={frameRef}
        src={humanCheckPageUrl(action)}
        title="Cloudflare Turnstile"
        scrolling="no"
        onLoad={markLoaded}
        className={`absolute inset-0 size-full border-0 bg-transparent transition-opacity duration-300 ease-out [color-scheme:dark] ${
          ready ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
