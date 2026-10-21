import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "@solar-icons/react";
import { usePlayerState } from "../hooks/usePlayerState";
import { useLyricsStore } from "@/features/lyrics";
import { useCoverSrc } from "@/features/covers";
import { useTranslation } from "@/languages";
import { BraccatoLyricsView } from "./FullscreenPlayer";

/**
 * Full screen live lyrics, opened from the queue sheet or the player.
 * The back button sits top right so the thumb can reach it.
 */
export default function LyricsPage() {
  const navigate = useNavigate();
  const player = usePlayerState();
  const { t } = useTranslation();
  const track = player.currentTrack;
  const coverSrc = useCoverSrc(track?.coverUrl);
  const { braccatoLyrics, lyricsLoading, currentLyricsTrackId } = useLyricsStore();

  const isMatching = Boolean(track?.id && currentLyricsTrackId === track.id);
  const lyrics = isMatching ? braccatoLyrics : [];
  const hasLyrics = lyrics.length > 0;

  // nothing to sing along to: never leave a blank screen behind
  useEffect(() => {
    if (!track) navigate("/", { replace: true });
  }, [track, navigate]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/", { replace: true });
  };

  return (
    <div
      data-theme="dark"
      className="dark relative h-full w-full overflow-hidden bg-black text-white [&_.blyrics-container]:[--blyrics-font-size:1.45rem] [&_.blyrics-container]:[--blyrics-padding:0.85rem] md:[&_.blyrics-container]:[--blyrics-font-size:2rem]"
    >
      <div aria-hidden="true" className="absolute inset-0">
        <div className="absolute inset-0 bg-black" />
        {coverSrc && (
          <div
            className="absolute inset-0 scale-125 bg-cover bg-center opacity-40 blur-3xl"
            style={{ backgroundImage: `url(${coverSrc})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/55 to-black/90" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col">
        <header className="flex shrink-0 items-start justify-between gap-[12px] px-[18px] pt-[max(14px,env(safe-area-inset-top))] pb-[8px]">
          <div className="min-w-0">
            <p className="m-0 truncate text-[15px] font-semibold leading-tight">
              {track?.title || t("player.nothing_playing")}
            </p>
            <p className="m-0 mt-[2px] truncate text-[12.5px] text-white/60">
              {track?.artists || ""}
            </p>
          </div>

          <button
            type="button"
            onClick={goBack}
            aria-label={t("common.back") || "Back"}
            className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.08] text-white/85 backdrop-blur-md transition-colors active:bg-white/[0.16]"
          >
            <ArrowLeft size={19} />
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col pb-[max(12px,env(safe-area-inset-bottom))]">
          {hasLyrics ? (
            <BraccatoLyricsView lyrics={braccatoLyrics} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-[10px] px-[32px] text-center">
              {lyricsLoading ? (
                <>
                  <span className="h-[24px] w-[24px] animate-spin rounded-full border-[2.5px] border-white/20 border-t-white/80" />
                  <span className="text-[13px] text-white/60">
                    {t("common.loading") || "Loading"}
                  </span>
                </>
              ) : (
                <span className="text-[14px] text-white/55">
                  {t("player.no_lyrics") || "No lyrics for this track"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
