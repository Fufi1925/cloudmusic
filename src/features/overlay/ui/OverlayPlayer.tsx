import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "@/languages";
import { motion } from "framer-motion";
import {
  SkipNext,
  SkipPrevious,
} from "@solar-icons/react";
import {
  PlayerMorphIcon,
  ICON_PLAY,
  ICON_PAUSE,
} from "@/features/player/ui/morphPlayerIcons";
import { HeartFill, HeartLine } from "@mingcute/react";
import CoverImage from "@/features/covers/ui/CoverImage";
import { ScrollableText } from "@/shared/ui/ScrollableText";
import { useDisableButtonFocus } from "@/features/navigation/hooks/useDisableButtonFocus";
import { getAuthSession } from "@/shared/api";
import type { OverlayAction, OverlayStatePayload } from "../contracts";
import {
  useCustomizationStore,
  loadPersistedWallpaper,
  DEFAULT_GLASS_CONFIG,
} from "@/features/settings";
import { useShortcutsStore, matchesShortcut } from "@/features/shortcuts";

const OVERLAY_CARD_TRANSITION = {
  duration: 0.08,
  ease: [0.16, 1, 0.3, 1],
} as const;

export function OverlayPlayer() {
  useDisableButtonFocus();
  const { t } = useTranslation();

  const [state, setState] = useState<OverlayStatePayload>({
    status: "idle",
    track: null,
    positionMs: 0,
    durationMs: 0,
    volume: 1,
    isLiked: false,
  });

  const [isInfoHovered, setIsInfoHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const anchorPosRef = useRef(state.positionMs);
  const anchorTimeRef = useRef(performance.now());
  const [interpolatedPosMs, setInterpolatedPosMs] = useState(state.positionMs);
  const lastTrackIdRef = useRef<string | null>(null);


  useEffect(() => {
    if (!getAuthSession()) {
      window.cloudMusicElectron?.closeOverlay?.();
      return;
    }

    window.cloudMusicElectron?.getOverlayInitialState?.().then((initial) => {
      if (initial) {
        anchorPosRef.current = initial.positionMs;
        anchorTimeRef.current = performance.now();
        setInterpolatedPosMs(initial.positionMs);
        setState(initial);
      }
    });

    if (window.cloudMusicElectron?.onOverlayState) {
      const cleanupState = window.cloudMusicElectron.onOverlayState((newState) => {
        setState(newState);
      });
      return cleanupState;
    }
  }, []);

  useEffect(() => {
    if (!window.cloudMusicElectron?.onOverlayVisibility) return;
    const cleanupVisibility = window.cloudMusicElectron.onOverlayVisibility((visible) => {
      setIsVisible(visible);
    });
    return cleanupVisibility;
  }, []);

  const sendAction = useCallback((action: OverlayAction) => {
    window.cloudMusicElectron?.sendOverlayAction?.(action);
  }, []);

  const isPlaying = state.status === "playing";
  const durationMs = Math.max(1, state.durationMs || state.track?.durationMs || 1);

  useEffect(() => {
    if (state.track?.id !== lastTrackIdRef.current) {
      lastTrackIdRef.current = state.track?.id ?? null;
      setInterpolatedPosMs(state.positionMs);
      anchorPosRef.current = state.positionMs;
      anchorTimeRef.current = performance.now();
      return;
    }

    if (state.status === "paused") {
      const pos = state.positionMs > 0 ? state.positionMs : interpolatedPosMs;
      setInterpolatedPosMs(pos);
      anchorPosRef.current = pos;
      anchorTimeRef.current = performance.now();
      return;
    }

    if (state.positionMs > 0 || interpolatedPosMs === 0) {
      setInterpolatedPosMs(state.positionMs);
      anchorPosRef.current = state.positionMs;
      anchorTimeRef.current = performance.now();
    }
  }, [state.positionMs, state.status, state.track?.id]);

  useEffect(() => {
    if (!isPlaying) return;
    let animId: number;

    const step = () => {
      if (document.hidden) {
        animId = requestAnimationFrame(step);
        return;
      }
      const elapsed = performance.now() - anchorTimeRef.current;
      const current = Math.min(durationMs, anchorPosRef.current + elapsed);
      setInterpolatedPosMs(current);
      animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(animId);
      const elapsed = performance.now() - anchorTimeRef.current;
      anchorPosRef.current = Math.min(durationMs, anchorPosRef.current + elapsed);
      anchorTimeRef.current = performance.now();
    };
  }, [isPlaying, durationMs]);

  const currentPosMs = interpolatedPosMs;
  const progressRatio = Math.min(1, Math.max(0, currentPosMs / durationMs));

  const backgroundImage = useCustomizationStore((s) => s.backgroundImage);
  const backgroundBlur = useCustomizationStore((s) => s.backgroundBlur);
  const backgroundDim = useCustomizationStore((s) => s.backgroundDim);
  const contentViewConfig = useCustomizationStore((s) => s.contentView);
  const miniplayerConfig = useCustomizationStore((s) => s.miniplayer);
  const hasCustomBg = Boolean(backgroundImage);

  const activeBlockConfig =
    (miniplayerConfig && (miniplayerConfig.opacity < 100 || miniplayerConfig.blur > 0 || miniplayerConfig.dim > 0))
      ? miniplayerConfig
      : (contentViewConfig && (contentViewConfig.opacity < 100 || contentViewConfig.blur > 0 || contentViewConfig.dim > 0))
        ? contentViewConfig
        : DEFAULT_GLASS_CONFIG;

  const alpha = Math.min(0.85, (activeBlockConfig?.opacity ?? 70) / 100);
  const dimAlpha = (activeBlockConfig?.dim ?? 15) / 100;
  const blurPx = activeBlockConfig?.blur ?? 24;

  const tintBackground = dimAlpha > 0
    ? `linear-gradient(rgba(0, 0, 0, ${dimAlpha}), rgba(0, 0, 0, ${dimAlpha})), rgba(12, 12, 14, ${alpha})`
    : `rgba(12, 12, 14, ${alpha})`;

  useEffect(() => {
    void loadPersistedWallpaper().then((img) => {
      if (img) {
        useCustomizationStore.setState({ backgroundImage: img });
      }
    });
  }, []);

  // Keyboard Shortcuts (Miniplayer mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const { miniplayer } = useShortcutsStore.getState();

      // Sound up / down shortcuts
      if (matchesShortcut(e, miniplayer.volumeUp)) {
        e.preventDefault();
        sendAction({ type: "volumeUp" });
        return;
      }

      if (matchesShortcut(e, miniplayer.volumeDown)) {
        e.preventDefault();
        sendAction({ type: "volumeDown" });
        return;
      }

      // Switch to main app
      if (matchesShortcut(e, miniplayer.focusMainWindow)) {
        e.preventDefault();
        sendAction({ type: "focusMainWindow" });
        return;
      }

      // Playback toggle
      if (matchesShortcut(e, miniplayer.playPause)) {
        e.preventDefault();
        sendAction({ type: "togglePlay" });
        return;
      }

      // Seek left / right
      if (matchesShortcut(e, miniplayer.seekBackward)) {
        e.preventDefault();
        sendAction({ type: "seek", payload: { positionMs: Math.max(0, currentPosMs - 5000) } });
        return;
      }

      if (matchesShortcut(e, miniplayer.seekForward)) {
        e.preventDefault();
        sendAction({ type: "seek", payload: { positionMs: Math.min(durationMs, currentPosMs + 5000) } });
        return;
      }

      // Like
      if (matchesShortcut(e, miniplayer.likeTrack)) {
        e.preventDefault();
        sendAction({ type: "like" });
        return;
      }

      // Previous
      if (matchesShortcut(e, miniplayer.prevTrack)) {
        e.preventDefault();
        sendAction({ type: "prev" });
        return;
      }

      // Next
      if (matchesShortcut(e, miniplayer.nextTrack)) {
        e.preventDefault();
        sendAction({ type: "next" });
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPosMs, durationMs, sendAction, state.volume]);

  // ── dragging the pill ──────────────────────────────────────────────────
  // the window is frameless, so we move it ourselves: the renderer just reports
  // pointer travel and the main process shifts the window (position is kept in
  // overlay-settings.json). buttons opt out via the closest() check.
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // linux hands the move to the compositor (css app-region) because wayland
  // ignores setPosition; windows/macos get the explicit ipc drag, which also
  // keeps the window size pinned while crossing displays
  const usesNativeDrag = window.cloudMusicElectron?.platform === "linux";

  const handleDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (usesNativeDrag) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("button, a, input, textarea, select, [role='button'], [data-no-overlay-drag]")) return;
    dragRef.current = { x: e.screenX, y: e.screenY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [usesNativeDrag]);

  const handleDragPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (usesNativeDrag) return;
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.screenX - drag.x) < 3 && Math.abs(e.screenY - drag.y) < 3) return;
      drag.moved = true;
      window.cloudMusicElectron?.startOverlayDrag?.();
    }
    window.cloudMusicElectron?.moveOverlayDrag?.();
  }, [usesNativeDrag]);

  const endDrag = useCallback((pointerId?: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (pointerId !== undefined) {
      try {
        (document.querySelector("[data-overlay-drag-surface]") as HTMLElement | null)?.releasePointerCapture?.(pointerId);
      } catch {}
    }
    if (drag?.moved) window.cloudMusicElectron?.endOverlayDrag?.();
  }, []);

  const handleDragPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endDrag(e.pointerId);
    },
    [endDrag],
  );

  // double click on empty pill area -> back to the preset corner
  const handleDragDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("button, a, input, textarea, select, [role='button'], [data-no-overlay-drag]")) return;
    void window.cloudMusicElectron?.resetOverlayPosition?.();
  }, []);

  return (
    <div
      data-overlay-drag-surface
      className="flex h-screen w-screen select-none flex-col justify-start bg-transparent antialiased overflow-hidden font-sans p-1 m-0 border-0"
      style={{
        cursor: "grab",
        ...(usesNativeDrag ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : {}),
      }}
      onPointerDown={handleDragPointerDown}
      onPointerMove={handleDragPointerMove}
      onPointerUp={handleDragPointerUp}
      onPointerCancel={handleDragPointerUp}
      onLostPointerCapture={() => endDrag()}
      onDoubleClick={handleDragDoubleClick}
    >
      {/* ── Main Overlay Card ── */}
      <motion.div
        initial={false}
        animate={{
          opacity: isVisible ? 1 : 0,
          scale: isVisible ? 1 : 0.92,
        }}
        transition={OVERLAY_CARD_TRANSITION}
        className="relative flex w-full shrink-0 flex-col overflow-hidden rounded-[10px] bg-[#0d0d10]"
        style={{
          height: "48px",
          willChange: "transform, opacity",
          transformOrigin: "center center",
        }}
      >
        {/* Wallpaper background */}
        {hasCustomBg && backgroundImage && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            <div className="absolute inset-0 bg-[#0d0d10]" />
            <img
              src={backgroundImage}
              alt=""
              className="h-full w-full object-cover select-none"
              style={{
                filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined,
                transform: backgroundBlur > 0 ? "scale(1.12)" : undefined,
              }}
            />
            {backgroundDim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: backgroundDim / 100 }} />}
            <div
              className="absolute inset-0"
              style={{
                background: tintBackground,
                backdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
                WebkitBackdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
              }}
            />
          </div>
        )}

        {/* Background Progress Fill - Straight rectangular without rounding */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] rounded-none"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.08)",
            width: `${progressRatio * 100}%`,
            transition: "width 200ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />

        {/* Content Row */}
        <div className="relative z-[2] flex h-full w-full items-center justify-between px-2.5">
          {/* Left: Artwork + Track Info (Fully draggable to drag window) */}
          <div
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden cursor-default pr-2"
            onMouseEnter={() => setIsInfoHovered(true)}
            onMouseLeave={() => setIsInfoHovered(false)}
          >
            <div className="relative h-[32px] w-[32px] shrink-0 overflow-hidden rounded-[6px] bg-[#16161a]">
              {state.track?.coverUrl || state.track?.cover ? (
                <CoverImage
                  key={state.track.coverUrl || state.track.cover}
                  src={state.track.coverUrl || state.track.cover || ""}
                  alt={state.track?.title || "Artwork"}
                  fill
                  sizes="32px"
                  priority
                  unoptimized
                  draggable={false}
                  className="rounded-[6px] object-cover pointer-events-none select-none"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[11px] text-white/30 select-none">
                  ♪
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
              <ScrollableText
                text={state.track?.title || "No track playing"}
                isParentHovered={isInfoHovered}
                className="text-[13px] font-normal leading-[16px] text-white tracking-tight"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              />
              <ScrollableText
                text={state.track?.artist || ""}
                isParentHovered={isInfoHovered}
                className="mt-[1px] text-[11px] font-light leading-[14px] text-white/50"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              />
            </div>
          </div>

          {/* Right: Like Button + Playback Controls (Previous, Play/Pause, Next) */}
          <div
            className="flex items-center gap-0.5 shrink-0 pl-1"
            data-no-overlay-drag
            style={usesNativeDrag ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                sendAction({ type: "like" });
              }}
              className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border-0 bg-transparent transition-colors outline-none cursor-pointer active:scale-90 ${
                state.isLiked
                  ? "text-[#ff3b5c]"
                  : "text-white/40 hover:text-white"
              }`}
              aria-label={state.isLiked ? "Unlike" : "Like"}
            >
              {state.isLiked ? <HeartFill size={16} /> : <HeartLine size={16} />}
            </button>

            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                sendAction({ type: "prev" });
              }}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-lg border-0 bg-transparent text-white/60 hover:text-white active:scale-90 transition-all outline-none cursor-pointer"
              aria-label="Previous"
            >
              <SkipPrevious size={16} weight="Bold" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                sendAction({ type: "togglePlay" });
              }}
              className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-full bg-white text-black shadow transition-all duration-150 ease-out hover:scale-105 active:scale-95 border-none cursor-pointer"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              <span
                className={`flex items-center justify-center transition-transform ${
                  isPlaying ? "" : "translate-x-[0.5px]"
                }`}
              >
                <PlayerMorphIcon
                  icon={isPlaying ? ICON_PAUSE : ICON_PLAY}
                  size={14}
                />
              </span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                sendAction({ type: "next" });
              }}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-lg border-0 bg-transparent text-white/60 hover:text-white active:scale-90 transition-all outline-none cursor-pointer"
              aria-label="Next"
            >
              <SkipNext size={16} weight="Bold" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default OverlayPlayer;
