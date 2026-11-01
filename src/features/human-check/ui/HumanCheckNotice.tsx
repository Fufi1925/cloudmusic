import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "@/languages";
import { getApiBaseUrl } from "@/shared/api/baseUrl";
import { formatAuthTrace } from "@/shared/api/authDiagnostics";
import { APP_VERSION } from "@/shared/config/version";
import { useIsCompact } from "@/shared/hooks/useCompactLayout";
import { useHumanCheckStore } from "../store/humanCheckStore";
import CheckFrame from "./CheckFrame";

const buttonBase =
  "h-[38px] flex-1 rounded-lg px-[14px] text-[13px] font-[500] transition-colors";

function apiHost(): string {
  try {
    return new URL(getApiBaseUrl()).host;
  } catch {
    return getApiBaseUrl();
  }
}

/**
 * Small floating panel that hosts the turnstile iframe while the api asks for a
 * human check (login/registration). Rendered once, app-wide. On phones it docks
 * to the bottom so it can never end up off-screen.
 */
export default function HumanCheckNotice() {
  const { t } = useTranslation();
  const compact = useIsCompact();
  const request = useHumanCheckStore((state) => state.request);
  const phase = useHumanCheckStore((state) => state.phase);
  const attempt = useHumanCheckStore((state) => state.attempt);
  const retry = useHumanCheckStore((state) => state.retry);
  const cancel = useHumanCheckStore((state) => state.cancel);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!request) {
      setShowDetails(false);
      setCopied(false);
    }
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, cancel]);

  if (typeof document === "undefined") return null;

  const trace = showDetails ? formatAuthTrace(getApiBaseUrl()) : "";

  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(formatAuthTrace(getApiBaseUrl()));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {request && (
        <motion.div
          role="dialog"
          aria-live="polite"
          data-no-window-drag
          initial={{ opacity: 0, y: compact ? 24 : -16, scale: compact ? 1 : 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: compact ? 24 : -12, scale: compact ? 1 : 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className={`fixed z-[9998] flex flex-col rounded-xl border border-border-primary bg-bg-panel p-[18px] shadow-[0_24px_80px_rgba(0,0,0,0.35)] ${
            compact
              ? "inset-x-[12px] bottom-[max(12px,env(safe-area-inset-bottom))] w-auto"
              : "left-1/2 top-[44px] w-[356px] max-w-[calc(100vw-24px)] -translate-x-1/2"
          }`}
        >
          <div className="flex items-start gap-[12px]">
            <span className="mt-[1px] flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-bg-elevated text-[15px] text-text-secondary">
              🛡
            </span>
            <div className="flex min-w-0 flex-col">
              <h2 className="m-0 text-[15px] font-[600] leading-[1.25] tracking-[-0.01em] text-text-primary">
                {t("human_check.title")}
              </h2>
              <p className="m-0 mt-[4px] text-[12.5px] leading-[1.4] text-text-secondary">
                {t("human_check.description")}
              </p>
            </div>
          </div>

          <div className="mt-[12px]">
            <CheckFrame action={request.action} attempt={attempt} />
          </div>

          <div className="mt-[10px] flex gap-[8px]">
            <button
              type="button"
              onClick={retry}
              className={`${buttonBase} cursor-pointer bg-bg-elevated text-text-primary hover:bg-bg-elevated/80`}
            >
              {t("human_check.retry")}
            </button>
            <button
              type="button"
              onClick={cancel}
              className={`${buttonBase} cursor-pointer bg-transparent text-text-secondary hover:text-text-primary`}
            >
              {request.mode === "optional" ? t("human_check.skip") : t("human_check.cancel")}
            </button>
          </div>

          {/* always visible: what build, which api, which phase - readable in a screenshot */}
          <div className="mt-[10px] flex items-center justify-between gap-[8px] text-[10.5px] leading-[1.3] text-text-tertiary">
            <span className="truncate font-mono">
              v{APP_VERSION} · {apiHost()} · {phase} · #{attempt}
            </span>
            <button
              type="button"
              onClick={() => setShowDetails((value) => !value)}
              className="shrink-0 cursor-pointer bg-transparent text-[10.5px] text-text-tertiary underline decoration-dotted hover:text-text-secondary"
            >
              {showDetails ? t("human_check.details_hide") : t("human_check.details_show")}
            </button>
          </div>

          {showDetails && (
            <>
              <pre className="m-0 mt-[6px] max-h-[132px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg-elevated p-[8px] font-mono text-[10.5px] leading-[1.45] text-text-secondary">
                {trace || "—"}
              </pre>
              <button
                type="button"
                onClick={copyTrace}
                className="mt-[6px] cursor-pointer self-start bg-transparent text-[11px] text-text-tertiary underline decoration-dotted hover:text-text-secondary"
              >
                {copied ? t("human_check.details_copied") : t("human_check.details_copy")}
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
