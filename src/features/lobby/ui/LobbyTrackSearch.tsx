import { useMemo, useState } from "react";
import { Magnifer, AddCircle, MusicNote } from "@solar-icons/react";
import { useTranslation } from "@/languages";
import { useSearchTracks } from "@/features/search";
import { usePlayerStore } from "@/features/player";
import { showToast } from "@/shared/ui";
import type { Track } from "@/shared/lobby";
import { useLobbyStore } from "../store/lobbyStore";
import { publishHostPlayback } from "../sync/lobbySync";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/**
 * Search + pick a song inside the lobby.
 *
 * Listeners send it as a wish (the host gets a yes/no pop-up), the host simply
 * appends it to the room's queue.
 */
export default function LobbyTrackSearch() {
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const requests = useLobbyStore((state) => state.requests);
  const requestTrack = useLobbyStore((state) => state.requestTrack);
  const voteRequest = useLobbyStore((state) => state.voteRequest);
  const allowRequests = useLobbyStore((state) => state.settings.allowRequests);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { tracks, loading } = useSearchTracks(query, { enabled: open && query.trim().length >= 2, limit: 8 });

  const wishedTrackIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const request of requests) map.set(request.track.id, request.id);
    return map;
  }, [requests]);

  const results = tracks.slice(0, 8);
  const isHost = role === "host";

  const addForHost = (track: Track) => {
    const player = usePlayerStore.getState();
    const queue = player.queue ?? [];
    if (queue.some((entry) => entry.id === track.id)) {
      showToast(t("lobby.search.already_queued"), "info");
      return;
    }
    usePlayerStore.getState().setQueue([...queue, track]);
    publishHostPlayback(true);
    showToast(t("lobby.search.added"), "success", { description: track.title });
  };

  const wish = (track: Track) => {
    const existing = wishedTrackIds.get(track.id);
    if (existing) {
      voteRequest(existing);
      return;
    }
    requestTrack(track);
  };

  if (!isHost && !allowRequests) {
    return (
      <div className="rounded-xl border border-solid border-border-primary bg-border-alpha-08 p-[14px]" style={font}>
        <p className="m-0 text-[12.5px] text-text-tertiary" style={font}>
          {t("lobby.search.disabled")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-solid border-border-primary bg-border-alpha-08 p-[14px]" style={font}>
      <p className="m-0 mb-[6px] text-[13px] font-[600] text-text-primary" style={font}>
        {isHost ? t("lobby.search.title_host") : t("lobby.search.title")}
      </p>
      <p className="m-0 mb-[10px] text-[12.5px] leading-snug text-text-tertiary" style={font}>
        {isHost ? t("lobby.search.description_host") : t("lobby.search.description")}
      </p>

      <div className="flex items-center gap-[7px] rounded-lg bg-border-alpha-14 px-[9px]">
        <Magnifer size={14} className="shrink-0 text-text-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("lobby.search.placeholder")}
          className="h-[34px] min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-tertiary"
          style={font}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="shrink-0 border-0 bg-transparent p-0 text-[11px] text-text-tertiary hover:text-text-primary"
            style={font}
          >
            {t("common.cancel")}
          </button>
        ) : null}
      </div>

      {open && query.trim().length >= 2 ? (
        <div className="mt-[8px] flex flex-col gap-[2px]">
          {loading && results.length === 0 ? (
            <p className="m-0 py-[6px] text-[12px] text-text-tertiary" style={font}>
              {t("lobby.search.loading")}
            </p>
          ) : null}

          {!loading && results.length === 0 ? (
            <p className="m-0 py-[6px] text-[12px] text-text-tertiary" style={font}>
              {t("lobby.search.empty")}
            </p>
          ) : null}

          {results.map((track) => {
            const wished = wishedTrackIds.get(track.id);
            const wishCount = requests.find((request) => request.id === wished)?.voteCount ?? 0;
            return (
              <div
                key={track.id}
                className="flex items-center gap-[8px] rounded-lg bg-border-alpha-08 px-[7px] py-[5px]"
              >
                <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-border-alpha-14 text-text-tertiary">
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <MusicNote size={13} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-text-primary" style={font}>
                    {track.title}
                  </span>
                  <span className="block truncate text-[11px] text-text-tertiary" style={font}>
                    {track.artists}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => (isHost ? addForHost(track) : wish(track))}
                  className={`inline-flex shrink-0 items-center gap-[4px] rounded-md border-0 px-[8px] py-[4px] text-[11.5px] transition-colors ${
                    wished
                      ? "bg-text-primary text-bg-primary"
                      : "bg-border-alpha-14 text-text-secondary hover:text-text-primary"
                  }`}
                  style={font}
                  title={wished ? t("lobby.search.vote_hint") : undefined}
                >
                  <AddCircle size={12} />
                  {isHost
                    ? t("lobby.search.queue")
                    : wished
                      ? t("lobby.search.voted", { count: String(wishCount) })
                      : t("lobby.search.wish")}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
