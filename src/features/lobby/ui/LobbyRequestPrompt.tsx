import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, CloseCircle } from "@solar-icons/react";
import { useTranslation } from "@/languages";
import { useLobbyStore } from "../store/lobbyStore";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/**
 * The host's right-hand pop-up: somebody wished a song, yes or no?
 * It sits on the right edge of the window, stacks up to three wishes and never
 * steals the focus – the host keeps DJing while deciding.
 */
export default function LobbyRequestPrompt() {
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const requests = useLobbyStore((state) => state.requests);
  const answerRequest = useLobbyStore((state) => state.answerRequest);

  if (role !== "host" || requests.length === 0) return null;

  const visible = requests.slice(0, 3);

  return (
    <div
      className="pointer-events-none fixed right-[18px] top-[86px] z-[520] flex w-[308px] flex-col gap-[8px]"
      style={font}
    >
      <AnimatePresence initial={false}>
        {visible.map((request) => (
          <motion.div
            key={request.id}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto overflow-hidden rounded-xl border border-solid border-border-primary bg-bg-elevated shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
          >
            <div className="flex items-center gap-[6px] border-0 border-b border-solid border-border-primary px-[12px] py-[7px]">
              <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#F79009]" />
              <span className="text-[11px] font-[600] uppercase tracking-[0.07em] text-text-tertiary">
                {t("lobby.wish.prompt_title")}
              </span>
              <span className="min-w-0 flex-1" />
              <span className="shrink-0 text-[11px] text-text-tertiary">
                {t(request.voteCount === 1 ? "lobby.wish.votes_one" : "lobby.wish.votes", {
                  count: String(request.voteCount),
                })}
              </span>
            </div>

            <div className="flex items-center gap-[10px] px-[12px] py-[10px]">
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-border-alpha-14 text-[13px] text-text-tertiary">
                {request.track.coverUrl ? (
                  <img
                    src={request.track.coverUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  "♪"
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[13px] font-[600] text-text-primary" style={font}>
                  {request.track.title}
                </p>
                <p className="m-0 truncate text-[11.5px] text-text-tertiary" style={font}>
                  {request.track.artists || t("lobby.wish.unknown_artist")}
                </p>
                <p className="m-0 mt-[2px] truncate text-[11px] text-text-tertiary" style={font}>
                  {t("lobby.wish.from", { name: request.name })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-[6px] px-[12px] pb-[10px]">
              <button
                type="button"
                onClick={() => answerRequest(request.id, false)}
                className="inline-flex flex-1 items-center justify-center gap-[5px] rounded-lg border-0 bg-border-alpha-14 px-[10px] py-[7px] text-[12px] text-text-secondary transition-colors hover:bg-[#E81123]/15 hover:text-[#E81123]"
                style={font}
              >
                <CloseCircle size={13} />
                {t("lobby.wish.decline")}
              </button>
              <button
                type="button"
                onClick={() => answerRequest(request.id, true)}
                className="inline-flex flex-1 items-center justify-center gap-[5px] rounded-lg border-0 bg-text-primary px-[10px] py-[7px] text-[12px] font-[500] text-bg-primary"
                style={font}
              >
                <CheckCircle size={13} />
                {t("lobby.wish.accept")}
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {requests.length > visible.length ? (
        <p className="pointer-events-none m-0 text-right text-[11px] text-text-tertiary" style={font}>
          {t("lobby.wish.more", { count: String(requests.length - visible.length) })}
        </p>
      ) : null}
    </div>
  );
}
