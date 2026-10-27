import { UsersGroupRounded } from "@solar-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "@/languages";
import { useLobbyStore } from "../store/lobbyStore";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/**
 * Slim bar above the player: your code, who is listening and the way out.
 * Deliberately quiet – the host should still be able to use everything else.
 */
export default function LobbyStrip() {
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const code = useLobbyStore((state) => state.code);
  const hostName = useLobbyStore((state) => state.hostName);
  const members = useLobbyStore((state) => state.members);
  const connection = useLobbyStore((state) => state.connection);
  const leaveLobby = useLobbyStore((state) => state.leaveLobby);

  const visible = !!role && !!code;

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 34 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="relative z-[56] w-full shrink-0 overflow-hidden"
        >
          <div
            className="mx-auto flex h-[34px] w-full items-center gap-[8px] rounded-lg border border-solid border-border-primary bg-bg-elevated/80 px-[10px] backdrop-blur-md"
            style={font}
          >
            <span
              className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                connection === "connected" ? "bg-[#12B76A]" : "bg-[#F79009]"
              }`}
            />
            <UsersGroupRounded size={13} className="shrink-0 text-text-tertiary" />
            <span className="shrink-0 text-[11.5px] font-[500] text-text-primary" style={font}>
              {t("lobby.strip.label")}
            </span>
            <span className="shrink-0 text-[11.5px] tabular-nums tracking-[0.18em] text-text-secondary" style={font}>
              {code}
            </span>
            <span className="shrink-0 text-[11.5px] text-text-tertiary" style={font}>
              ·
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-tertiary" style={font}>
              {role === "host"
                ? members.length === 0
                  ? t("lobby.strip.listeners_zero")
                  : members.length === 1
                    ? t("lobby.strip.listeners_one", { count: String(members.length) })
                    : t("lobby.strip.listeners", { count: String(members.length) })
                : t("lobby.strip.listening_to", { name: hostName ?? "" })}
            </span>
            <button
              type="button"
              onClick={leaveLobby}
              className="shrink-0 rounded-md border-0 bg-transparent px-[7px] py-[3px] text-[11.5px] text-text-tertiary transition-colors hover:bg-border-alpha-14 hover:text-[#E81123]"
              style={font}
            >
              {t("lobby.leave")}
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
