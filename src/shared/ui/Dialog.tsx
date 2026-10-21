import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { isWindowDraggingActive } from "@/shared/hooks";
import { isEscapeGuarded } from "@/shared/utils/escapeGuard";
import { useIsCompact } from "@/shared/hooks/useCompactLayout";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  maxWidth?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  className?: string;
  zIndex?: number;
}

const activeDialogs: Array<() => void> = [];

export default function Dialog({
  open,
  onOpenChange,
  children,
  maxWidth = 360,
  minHeight,
  maxHeight,
  className = "",
  zIndex,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const isCompact = useIsCompact();
  const pointerStartRef = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const closeHandler = () => onOpenChange(false);
    activeDialogs.push(closeHandler);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A recorder (or similar) is waiting for keys: let it cancel itself first
        if (isEscapeGuarded()) return;
        // Only the top-most open dialog closes on Escape; parent dialogs stay open
        if (activeDialogs[activeDialogs.length - 1] !== closeHandler) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const idx = activeDialogs.indexOf(closeHandler);
      if (idx !== -1) {
        activeDialogs.splice(idx, 1);
      }
    };
  }, [open, onOpenChange]);

  if (!mounted || typeof document === "undefined") return null;

  // wide dialogs (settings, pickers) take the whole portrait screen, small
  // confirmations slide up as a bottom sheet
  const numericMax = typeof maxWidth === "number" ? maxWidth : Number.POSITIVE_INFINITY;
  const compactFullScreen = isCompact && numericMax >= 600;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      target: e.target,
    };
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isWindowDraggingActive()) {
      return;
    }
    const start = pointerStartRef.current;
    if (start) {
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (dist > 6) {
        return;
      }
      if (start.target !== e.currentTarget && (start.target as HTMLElement)?.closest?.("[data-dialog-container]")) {
        return;
      }
    }
    onOpenChange(false);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog-backdrop"
          data-dialog-backdrop="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[199] bg-black/40 backdrop-blur-[2px] rounded-4xl overflow-hidden"
          style={zIndex ? { zIndex: zIndex - 1 } : undefined}
          onPointerDown={handlePointerDown}
          onClick={handleBackdropClick}
        />
      )}
      {open && (
        <motion.div
          key="dialog"
          data-dialog-container="true"
          initial={{ opacity: 0, scale: 0.97, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 10 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className={`fixed inset-0 z-[200] flex justify-center pointer-events-none ${
            isCompact ? "items-end" : "items-center"
          }`}
          style={zIndex ? { zIndex } : undefined}
        >
          <div
            className={`pointer-events-auto w-full flex flex-col border border-border-primary bg-bg-primary overflow-hidden relative ${
              isCompact
                ? compactFullScreen
                  ? "mx-0 h-full max-h-full rounded-none border-0"
                  : "mx-0 mb-0 max-h-[88vh] rounded-t-2xl rounded-b-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)]"
                : "mx-[16px] max-h-[85vh] rounded-xl"
            } ${className || "pt-[16px]"}`}
            style={
              isCompact
                ? compactFullScreen
                  ? { minHeight: undefined, maxHeight: undefined }
                  // bottom sheets span the phone width; maxWidth only matters on desktop
                  : { minHeight, ...(maxHeight ? { maxHeight } : {}) }
                : { maxWidth, minHeight, ...(maxHeight ? { maxHeight } : {}) }
            }
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
