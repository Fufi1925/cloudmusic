import Dialog from "@/shared/ui/Dialog";
import { useTranslation } from "@/languages";
import { useLobbyStore } from "../store/lobbyStore";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/**
 * The pop-up the host gets when somebody types the code: yes or no.
 * Requests stack up here and are answered one by one.
 */
export default function LobbyJoinPrompt() {
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const pending = useLobbyStore((state) => state.pending);
  const approve = useLobbyStore((state) => state.approve);
  const deny = useLobbyStore((state) => state.deny);

  const request = role === "host" ? pending[0] : undefined;
  const open = !!request;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && request ? deny(request.userId) : undefined)} maxWidth={380} zIndex={500} className="p-0 !bg-bg-elevated">
      {request ? (
        <div className="flex flex-col gap-[14px] p-[18px]" style={font}>
          <div className="flex items-center gap-[10px]">
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-border-alpha-14 text-[15px] font-[600] text-text-primary">
              {request.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="m-0 truncate text-[14px] font-[600] text-text-primary" style={font}>
                {t("lobby.prompt.title", { name: request.name })}
              </p>
              <p className="m-0 mt-[2px] text-[12px] text-text-tertiary" style={font}>
                {t("lobby.prompt.description")}
              </p>
            </div>
          </div>

          {pending.length > 1 ? (
            <p className="m-0 text-[11.5px] text-text-tertiary" style={font}>
              {t("lobby.prompt.more", { count: String(pending.length - 1) })}
            </p>
          ) : null}

          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={() => deny(request.userId)}
              className="flex-1 rounded-lg border-0 bg-border-alpha-14 px-[12px] py-[9px] text-[13px] text-text-secondary transition-colors hover:bg-[#E81123]/15 hover:text-[#E81123]"
              style={font}
            >
              {t("lobby.prompt.decline")}
            </button>
            <button
              type="button"
              onClick={() => approve(request.userId)}
              className="flex-1 rounded-lg border-0 bg-text-primary px-[12px] py-[9px] text-[13px] font-[500] text-bg-primary"
              style={font}
            >
              {t("lobby.prompt.accept")}
            </button>
          </div>

          <p className="m-0 text-center text-[11px] leading-snug text-text-tertiary" style={font}>
            {t("lobby.prompt.cooldown_hint")}
          </p>
        </div>
      ) : null}
    </Dialog>
  );
}
