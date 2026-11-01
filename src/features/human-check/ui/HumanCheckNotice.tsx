import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "@/languages";
import { useHumanCheckStore } from "../store/humanCheckStore";
import CheckFrame from "./CheckFrame";

const buttonBase =
  "h-[36px] flex-1 rounded-lg px-[14px] text-[13px] font-[500] transition-colors";

/**
 * Small floating panel that hosts the turnstile iframe while the api asks for a
 * human check (login/registration). Rendered once, app-wide.
 */
export default function HumanCheckNotice() {
  const { t } = useTranslation();
  const request = useHumanCheckStore((state) => state.request);
  const phase = useHumanCheckStore((state) => state.phase);
  const attempt = useHumanCheckStore((state) => state.attempt);
  const retry = useHumanCheckStore((state) => state.retry);
  const cancel = useHumanCheckStore((state) => state.cancel);
  const failed = phase === "error";

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, cancel]);

  if (typeof document === "undefined") return null;

  const description =
    phase === "expired"
      ? t("human_check.expired")
      : failed
        ? t("human_check.failed")
        : t("human_check.description");

  return createPortal(
    <AnimatePresence>
      {request && (
        <motion.div
          role="dialog"
          aria-live="polite"
          data-no-window-drag
          initial={{ opacity: 0, y: -16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="fixed left-1/2 top-[44px] z-[9998] flex w-[356px] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col rounded-xl border border-border-primary bg-bg-panel p-[18px] shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
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
                {description}
              </p>
            </div>
          </div>

          <div className="mt-[12px]">
            <CheckFrame action={request.action} attempt={attempt} />
          </div>

          <div className="mt-[10px] flex gap-[8px]">
            <button
              type="button"
              disabled={!failed}
              onClick={failed ? retry : undefined}
              className={`${buttonBase} ${
                failed
                  ? "cursor-pointer bg-bg-elevated text-text-primary hover:bg-bg-elevated/80"
                  : "cursor-default bg-bg-elevated/60 text-text-secondary"
              }`}
            >
              {failed ? t("human_check.retry") : t("human_check.waiting")}
            </button>
            <button
              type="button"
              onClick={cancel}
              className={`${buttonBase} cursor-pointer bg-transparent text-text-secondary hover:text-text-primary`}
            >
              {request.mode === "optional"
                ? t("human_check.skip")
                : t("human_check.cancel")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
