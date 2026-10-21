import { memo, useRef } from "react";
import { Playlist, SkipNext } from "@solar-icons/react";
import { usePlayerState } from "../hooks/usePlayerState";
import { playerEngine } from "../engine/playerEngine";
import { PlayerMorphIcon, ICON_PLAY, ICON_PAUSE } from "./morphPlayerIcons";
import { CoverImage } from "@/features/covers";
import { ExplicitBadge } from "@/shared/ui";

interface CompactPlayerBarProps {
  onFullscreenOpen: () => void;
  onQueueToggle?: () => void;
}

/**
 * Portrait player bar that sits between the page content and the bottom
 * navigation (android / narrow windows). Tapping it opens the full screen
 * player, the trailing controls stay reachable with the thumb.
 */
function CompactPlayerBar({ onFullscreenOpen, onQueueToggle }: CompactPlayerBarProps) {
  const player = usePlayerState();
  const track = player.currentTrack;
  // horizontal swipe on the bar skips tracks, the way phone players behave
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  if (!track) return null;

  const isPlaying = player.status === "playing";
  const isLoading = player.status === "loading";
  const progress =
    player.durationMs > 0
      ? Math.min(1, Math.max(0, player.positionMs / player.durationMs))
      : 0;

  return (
    <div
      className="relative z-[56] w-full shrink-0 border-t border-border-primary/60 bg-bg-surface/95 backdrop-blur-2xl"
      data-compact-player
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px] bg-border-alpha-14"
      >
        <div
          className="h-full bg-text-primary/70 transition-[width] duration-200 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div
        role="button"
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          swipeStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start || event.pointerType === "mouse") return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
          if (dx > 0) void playerEngine.skipPrevious();
          else void playerEngine.skipNext();
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
        onClick={onFullscreenOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onFullscreenOpen();
          }
        }}
        className="flex h-[60px] w-full touch-pan-y items-center gap-[10px] pl-[12px] pr-[8px] cursor-pointer select-none active:bg-border-alpha-8"
      >
        <div className="relative h-[40px] w-[40px] shrink-0 overflow-hidden rounded-[10px] bg-bg-elevated">
          <CoverImage
            key={track.coverUrl}
            src={track.coverUrl}
            alt={track.title}
            fill
            sizes="40px"
            placeholder="empty"
            className="object-cover"
            draggable={false}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <div className="flex min-w-0 items-center gap-[5px]">
            {track.explicit && <ExplicitBadge size="sm" className="shrink-0" />}
            <span className="min-w-0 truncate text-[14.5px] font-[550] leading-tight text-text-primary">
              {track.title}
            </span>
          </div>
          <span className="min-w-0 truncate text-[12px] leading-tight text-text-tertiary">
            {track.artists}
          </span>
        </div>

        {onQueueToggle && (
          <button
            type="button"
            aria-label="Queue"
            onClick={(event) => {
              event.stopPropagation();
              onQueueToggle();
            }}
            className="flex h-[42px] w-[34px] shrink-0 items-center justify-center rounded-lg border-none bg-transparent text-text-secondary transition-transform active:scale-[0.94]"
          >
            <Playlist size={19} />
          </button>
        )}

        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={(event) => {
            event.stopPropagation();
            playerEngine.togglePlayPause();
          }}
          className="relative flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border-none bg-btn-primary-bg text-btn-primary-text active:scale-[0.94] transition-transform"
        >
          <PlayerMorphIcon icon={isPlaying ? ICON_PAUSE : ICON_PLAY} size={16} />
          {isLoading && (
            <span className="absolute h-[17px] w-[17px] animate-spin rounded-full border-[2px] border-current border-t-transparent" />
          )}
        </button>

        <button
          type="button"
          aria-label="Next track"
          onClick={(event) => {
            event.stopPropagation();
            void playerEngine.skipNext();
          }}
          className="flex h-[42px] w-[34px] shrink-0 items-center justify-center rounded-lg border-none bg-transparent text-text-secondary transition-transform active:scale-[0.94]"
        >
          <SkipNext size={19} weight="Bold" />
        </button>
      </div>
    </div>
  );
}

export default memo(CompactPlayerBar);
