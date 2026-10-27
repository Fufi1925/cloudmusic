import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseCircle, UsersGroupRounded } from "@solar-icons/react";
import { useTranslation } from "@/languages";

const CARD_BG = "#0d0d10";

/** shape pushed from the main window (see useLobbyOverlaySync) */
export interface LobbyOverlayState {
  active: boolean;
  role: "host" | "listener" | null;
  code: string | null;
  hostName: string | null;
  meId: string | null;
  members: Array<{ userId: string; name: string; online?: boolean }>;
  current: { title: string; artists?: string; coverUrl?: string | null } | null;
  next: Array<{ id: string; title: string; artists?: string }>;
  requests: Array<{ id: string; title: string; name: string; votes: number }>;
  votes: { skip: number; skipNeeded: number };
}

const EMPTY_STATE: LobbyOverlayState = {
  active: false,
  role: null,
  code: null,
  hostName: null,
  meId: null,
  members: [],
  current: null,
  next: [],
  requests: [],
  votes: { skip: 0, skipNeeded: 0 },
};

function coverLetter(name: string | undefined | null): string {
  return (name ?? "?").slice(0, 1).toUpperCase();
}

function Avatar({ name, online, host = false }: { name: string; online?: boolean; host?: boolean }) {
  return (
    <span
      className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[10px] font-[600] ${
        host
          ? "bg-white text-black"
          : online === false
            ? "bg-white/8 text-white/40"
            : "bg-white/16 text-white/85"
      }`}
    >
      {coverLetter(name)}
    </span>
  );
}

interface MenuTarget {
  userId: string;
  name: string;
  x: number;
  y: number;
}

export function LobbyOverlayPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<LobbyOverlayState>(EMPTY_STATE);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const send = useCallback((action: Record<string, unknown>) => {
    window.cloudMusicElectron?.sendLobbyOverlayAction?.(action);
  }, []);

  useEffect(() => {
    let alive = true;
    void window.cloudMusicElectron?.getLobbyOverlayInitialState?.().then((initial) => {
      if (alive && initial) setState(initial as LobbyOverlayState);
    });
    const offState = window.cloudMusicElectron?.onLobbyOverlayState?.((next) => {
      if (next) setState(next as LobbyOverlayState);
    });
    const offVisible = window.cloudMusicElectron?.onLobbyOverlayVisibility?.((next) => setVisible(next));
    return () => {
      alive = false;
      offState?.();
      offVisible?.();
    };
  }, []);

  // close the context menu as soon as anything else is clicked
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const isHost = state.role === "host";
  const onlineMembers = useMemo(() => state.members.filter((m) => m.online !== false), [state.members]);
  const connecting = !state.active;

  const openMenu = (event: React.MouseEvent, member: { userId: string; name: string }) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ userId: member.userId, name: member.name, x: event.clientX, y: event.clientY });
  };

  const menuItems: Array<{ label: string; danger?: boolean; run: () => void }> = [];
  if (menu) {
    if (isHost && menu.userId !== state.meId) {
      menuItems.push({
        label: t("lobby.overlay.kick"),
        danger: true,
        run: () => send({ type: "kick", userId: menu.userId }),
      });
    }
    menuItems.push({
      label: t("lobby.overlay.open"),
      run: () => send({ type: "focusMainWindow" }),
    });
    menuItems.push({
      label: t("lobby.overlay.reset_position"),
      run: () => send({ type: "resetPosition" }),
    });
    menuItems.push({
      label: t("lobby.overlay.hide"),
      run: () => send({ type: "closeOverlay" }),
    });
  }

  return (
    <div
      ref={rootRef}
      className="flex h-screen w-screen select-none flex-col bg-transparent p-1 font-sans antialiased"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-[10px] border border-solid border-white/10"
        style={{
          backgroundColor: CARD_BG,
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.96)",
          transition: "opacity 90ms ease-out, transform 90ms ease-out",
        }}
      >
        {/* header – the whole card can be dragged, buttons opt out */}
        <div className="flex h-[34px] shrink-0 items-center gap-[6px] border-0 border-b border-solid border-white/8 px-[10px]">
          <span
            className={`h-[6px] w-[6px] shrink-0 rounded-full ${
              connecting ? "bg-[#F79009]" : "bg-[#12B76A]"
            }`}
          />
          <span className="text-[11px] font-[600] uppercase tracking-[0.08em] text-white/60">
            {t("lobby.overlay.title")}
          </span>
          {state.code ? (
            <span className="rounded-full bg-white/10 px-[6px] py-[1px] text-[10.5px] tabular-nums text-white/80">
              {state.code}
            </span>
          ) : null}
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => send({ type: "closeOverlay" })}
            title={t("lobby.overlay.hide")}
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <CloseCircle size={13} />
          </button>
        </div>

        {connecting ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-[6px] px-[12px] text-center">
            <UsersGroupRounded size={18} />
            <p className="m-0 text-[11.5px] text-white/50">{t("lobby.overlay.empty")}</p>
          </div>
        ) : (
          <>
            {/* now playing + next up */}
            <div className="flex shrink-0 flex-col gap-[6px] px-[10px] py-[8px]">
              <div className="flex items-center gap-[8px]">
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-white/10">
                  {state.current?.coverUrl ? (
                    <img
                      src={state.current.coverUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="text-[10px] text-white/60">♪</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-[500] leading-tight text-white">
                    {state.current?.title ?? t("lobby.overlay.nothing")}
                  </span>
                  <span className="block truncate text-[10.5px] leading-tight text-white/45">
                    {state.current?.artists ?? state.hostName ?? ""}
                  </span>
                </span>
              </div>

              {state.next.length > 0 ? (
                <div className="flex flex-col gap-[1px] rounded-[6px] bg-white/5 px-[7px] py-[5px]">
                  <span className="text-[9.5px] uppercase tracking-[0.08em] text-white/35">
                    {t("lobby.overlay.next")}
                  </span>
                  {state.next.slice(0, 2).map((track) => (
                    <span key={track.id} className="truncate text-[11px] text-white/70">
                      {track.title}
                      {track.artists ? <span className="text-white/35"> · {track.artists}</span> : null}
                    </span>
                  ))}
                </div>
              ) : null}

              {state.requests.length > 0 ? (
                <div className="flex items-center gap-[5px] rounded-[6px] bg-[#F79009]/12 px-[7px] py-[4px]">
                  <span className="text-[10.5px] font-[500] text-[#F7B955]">
                    {t(state.requests.length === 1 ? "lobby.overlay.wishes_one" : "lobby.overlay.wishes", {
                      count: String(state.requests.length),
                    })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-white/45">
                    {state.requests[0].title}
                  </span>
                </div>
              ) : null}

              {state.votes.skipNeeded > 0 && state.votes.skip > 0 ? (
                <div className="flex items-center gap-[5px] rounded-[6px] bg-white/5 px-[7px] py-[4px]">
                  <span className="text-[10.5px] text-white/60">
                    {t("lobby.overlay.skip_votes", {
                      votes: String(state.votes.skip),
                      needed: String(state.votes.skipNeeded),
                    })}
                  </span>
                </div>
              ) : null}
            </div>

            {/* the room */}
            <div
              className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-[10px] pb-[8px]"
              style={{ scrollbarWidth: "none" }}
            >
              <div className="flex items-center gap-[6px]">
                <span className="text-[9.5px] uppercase tracking-[0.08em] text-white/35">
                  {t("lobby.overlay.members")}
                </span>
                <span className="text-[10px] text-white/30">{state.members.length + 1}</span>
              </div>

              <div className="flex items-center gap-[7px] py-[1px]">
                <Avatar name={state.hostName ?? "H"} host />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-white">{state.hostName}</span>
                <span className="rounded-full bg-white/10 px-[6px] py-[1px] text-[9.5px] text-white/55">
                  {t("lobby.members.host")}
                </span>
              </div>

              {onlineMembers.map((member) => (
                <div
                  key={member.userId}
                  data-member={member.userId}
                  className="flex items-center gap-[7px] rounded-[5px] px-[2px] py-[1px] hover:bg-white/5"
                  onContextMenu={(event) => openMenu(event, member)}
                  title={t("lobby.overlay.right_click")}
                >
                  <Avatar name={member.name} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/80">
                    {member.name}
                    {member.userId === state.meId ? (
                      <span className="text-white/35"> · {t("lobby.overlay.you")}</span>
                    ) : null}
                  </span>
                </div>
              ))}

              {state.members.length === 0 ? (
                <p className="m-0 py-[2px] text-[10.5px] text-white/30">{t("lobby.members.empty")}</p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center justify-between border-0 border-t border-solid border-white/8 px-[10px] py-[5px]">
              <span className="truncate text-[9.5px] text-white/30">
                {isHost ? t("lobby.overlay.host_hint") : t("lobby.overlay.listener_hint")}
              </span>
              <button
                type="button"
                onClick={() => send({ type: "focusMainWindow" })}
                className="shrink-0 rounded-[5px] border-0 bg-white/10 px-[7px] py-[3px] text-[10px] text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                {t("lobby.overlay.open")}
              </button>
            </div>
          </>
        )}
      </div>

      {menu ? (
        <div
          className="fixed z-50 min-w-[148px] overflow-hidden rounded-[7px] border border-solid border-white/12 bg-[#17171b] py-[3px] shadow-xl"
          style={{
            left: Math.max(4, Math.min(menu.x, window.innerWidth - 156)),
            top: Math.max(4, Math.min(menu.y, window.innerHeight - 172)),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="truncate px-[9px] py-[4px] text-[10px] uppercase tracking-[0.08em] text-white/35">
            {menu.name}
          </div>
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.run();
                setMenu(null);
              }}
              className={`block w-full border-0 bg-transparent px-[9px] py-[6px] text-left text-[11.5px] transition-colors hover:bg-white/10 ${
                item.danger ? "text-[#FF6B6B]" : "text-white/80"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default LobbyOverlayPanel;
