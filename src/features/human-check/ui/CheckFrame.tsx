import { useEffect, useRef } from "react";
import {
  humanCheckOrigin,
  humanCheckPageUrl,
  type HumanCheckAction,
} from "@/shared/api/humanCheck";
import { useHumanCheckStore } from "../store/humanCheckStore";

interface CheckMessage {
  source?: string;
  action?: string;
  type?: "token" | "error" | "expired";
  token?: string;
}

export interface CheckFrameProps {
  action: HumanCheckAction;
  attempt: number;
}

/**
 * The api's own turnstile page in an iframe. It posts the token back to us
 * (same protocol as upstream): `{source:"liner-turnstile", action, type, token}`.
 */
export default function CheckFrame({ action, attempt }: CheckFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const phase = useHumanCheckStore((state) => state.phase);
  const setPhase = useHumanCheckStore((state) => state.setPhase);
  const solve = useHumanCheckStore((state) => state.solve);
  const ready = phase !== "loading";

  useEffect(() => {
    const origin = humanCheckOrigin();
    const onMessage = (event: MessageEvent<CheckMessage>) => {
      if (!origin || event.origin !== origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "liner-turnstile" || data.action !== action) return;
      if (data.type === "token" && data.token) solve(data.token);
      else if (data.type === "expired") setPhase("expired");
      else if (data.type === "error") setPhase("error");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [action, setPhase, solve]);

  const markLoaded = () => {
    if (useHumanCheckStore.getState().phase === "loading") setPhase("ready");
  };

  return (
    <div className="relative mx-auto h-[78px] w-full shrink-0 overflow-hidden rounded-lg border border-border-primary bg-bg-elevated">
      {!ready && (
        <div className="absolute inset-0 animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/[0.06]" />
      )}
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
