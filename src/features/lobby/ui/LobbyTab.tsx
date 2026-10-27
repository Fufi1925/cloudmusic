import { useEffect, useMemo, useState } from "react";
import { Copy, UsersGroupRounded, CheckCircle, CloseCircle, Logout2 } from "@solar-icons/react";
import { useTranslation } from "@/languages";
import { showToast } from "@/shared/ui";
import { usePlayerStore } from "@/features/player";
import { useLobbyStore } from "../store/lobbyStore";
import { LobbyCodeField } from "./LobbyCodeField";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-solid border-border-primary bg-border-alpha-08 p-[14px] ${className}`}
      style={font}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mb-[6px] text-[13px] font-[600] text-text-primary" style={font}>
      {children}
    </p>
  );
}

function Description({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mb-[12px] text-[12.5px] leading-snug text-text-tertiary" style={font}>
      {children}
    </p>
  );
}

/** local countdown for the 5 minute reject cooldown */
function useRetryCountdown(retryAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(retryAt ? retryAt - Date.now() : null);

  useEffect(() => {
    if (!retryAt) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, retryAt - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  return remaining;
}

function CopyCodeButton({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code).then(
          () => showToast(t("lobby.code_copied"), "success"),
          () => showToast(t("lobby.code_copy_failed"), "error"),
        );
      }}
      className="inline-flex items-center gap-[6px] rounded-md border-0 bg-border-alpha-14 px-[9px] py-[5px] text-[12px] text-text-secondary transition-colors hover:bg-border-alpha-20 hover:text-text-primary"
      style={font}
    >
      <Copy size={14} />
      {t("lobby.copy_code")}
    </button>
  );
}

function QueueVotes() {
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const votes = useLobbyStore((state) => state.votes);
  const vote = useLobbyStore((state) => state.vote);
  const playback = useLobbyStore((state) => state.playback);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);

  const upcoming = useMemo(() => {
    const list = playback?.queue?.length ? playback.queue : queue;
    const index = playback?.queue?.length ? playback.index : currentIndex;
    return list.slice(index + 1, index + 6);
  }, [playback, queue, currentIndex]);

  if (role !== "listener" || upcoming.length === 0) return null;

  return (
    <Card>
      <SectionTitle>{t("lobby.vote.title")}</SectionTitle>
      <Description>{t("lobby.vote.description")}</Description>
      <div className="flex flex-col gap-[4px]">
        {upcoming.map((track, position) => {
          const count = votes.tracks[track.id]?.length ?? 0;
          return (
            <div
              key={`${track.id}-${position}`}
              className="flex items-center gap-[8px] rounded-lg bg-border-alpha-08 px-[8px] py-[6px]"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary" style={font}>
                {track.title}
              </span>
              <span className="shrink-0 text-[12px] text-text-tertiary" style={font}>
                {track.artists}
              </span>
              <button
                type="button"
                onClick={() => vote(track.id)}
                className={`inline-flex shrink-0 items-center gap-[4px] rounded-md border-0 px-[8px] py-[4px] text-[11.5px] transition-colors ${
                  count > 0
                    ? "bg-text-primary text-bg-primary"
                    : "bg-border-alpha-14 text-text-secondary hover:text-text-primary"
                }`}
                style={font}
              >
                {t("lobby.vote.action")}
                {count > 0 ? ` · ${count}` : ""}
              </button>
            </div>
          );
        })}
      </div>
      {currentTrack ? (
        <p className="m-0 mt-[10px] text-[11.5px] text-text-tertiary" style={font}>
          {t("lobby.vote.current", { title: currentTrack.title })}
        </p>
      ) : null}
    </Card>
  );
}

function MemberList() {
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const hostName = useLobbyStore((state) => state.hostName);
  const members = useLobbyStore((state) => state.members);

  return (
    <Card>
      <SectionTitle>
        {t("lobby.members.title", { count: String(members.length + 1) })}
      </SectionTitle>
      <div className="flex flex-col gap-[3px]">
        <div className="flex items-center gap-[8px] py-[3px]">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-text-primary text-[11px] font-[600] text-bg-primary">
            {(hostName ?? "H").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary" style={font}>
            {hostName}
          </span>
          <span className="shrink-0 rounded-full bg-border-alpha-14 px-[7px] py-[2px] text-[10.5px] text-text-secondary" style={font}>
            {t("lobby.members.host")}
          </span>
        </div>
        {members.map((member) => (
          <div key={member.userId} className="flex items-center gap-[8px] py-[3px]">
            <span
              className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] ${
                member.online === false
                  ? "bg-border-alpha-08 text-text-tertiary"
                  : "bg-border-alpha-20 text-text-primary"
              }`}
            >
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[12.5px] ${
                member.online === false ? "text-text-tertiary" : "text-text-secondary"
              }`}
              style={font}
            >
              {member.name}
            </span>
            {member.online === false ? (
              <span className="shrink-0 text-[10.5px] text-text-tertiary" style={font}>
                {t("lobby.members.offline")}
              </span>
            ) : null}
          </div>
        ))}
        {role === "host" && members.length === 0 ? (
          <p className="m-0 mt-[4px] text-[12px] text-text-tertiary" style={font}>
            {t("lobby.members.empty")}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function PendingRequests() {
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const pending = useLobbyStore((state) => state.pending);
  const approve = useLobbyStore((state) => state.approve);
  const deny = useLobbyStore((state) => state.deny);

  if (role !== "host" || pending.length === 0) return null;

  return (
    <Card className="!border-text-primary/25">
      <SectionTitle>{t("lobby.requests.title", { count: String(pending.length) })}</SectionTitle>
      <div className="flex flex-col gap-[6px]">
        {pending.map((request) => (
          <div key={request.userId} className="flex items-center gap-[8px]">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary" style={font}>
              {request.name}
            </span>
            <button
              type="button"
              onClick={() => approve(request.userId)}
              className="inline-flex items-center gap-[4px] rounded-md border-0 bg-text-primary px-[9px] py-[5px] text-[11.5px] font-[500] text-bg-primary"
              style={font}
            >
              <CheckCircle size={13} />
              {t("lobby.requests.accept")}
            </button>
            <button
              type="button"
              onClick={() => deny(request.userId)}
              className="inline-flex items-center gap-[4px] rounded-md border-0 bg-border-alpha-14 px-[9px] py-[5px] text-[11.5px] text-text-secondary"
              style={font}
            >
              <CloseCircle size={13} />
              {t("lobby.requests.decline")}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function LobbyTab({ searchQuery = "" }: { searchQuery?: string }) {
  void searchQuery;
  const { t } = useTranslation();
  const role = useLobbyStore((state) => state.role);
  const code = useLobbyStore((state) => state.code);
  const connection = useLobbyStore((state) => state.connection);
  const joinState = useLobbyStore((state) => state.joinState);
  const joinReason = useLobbyStore((state) => state.joinReason);
  const retryAt = useLobbyStore((state) => state.retryAt);
  const serverUrl = useLobbyStore((state) => state.serverUrl);
  const setServerUrl = useLobbyStore((state) => state.setServerUrl);
  const createLobby = useLobbyStore((state) => state.createLobby);
  const joinLobby = useLobbyStore((state) => state.joinLobby);
  const cancelJoin = useLobbyStore((state) => state.cancelJoin);
  const leaveLobby = useLobbyStore((state) => state.leaveLobby);
  const votes = useLobbyStore((state) => state.votes);
  const vote = useLobbyStore((state) => state.vote);

  const [draftCode, setDraftCode] = useState("");
  const [serverDraft, setServerDraft] = useState(serverUrl);
  const remaining = useRetryCountdown(retryAt);

  useEffect(() => setServerDraft(serverUrl), [serverUrl]);

  if (role) {
    const isHost = role === "host";
    return (
      <div className="flex flex-col gap-[10px]">
        <Card>
          <div className="flex items-start justify-between gap-[10px]">
            <div className="min-w-0">
              <p className="m-0 text-[11.5px] uppercase tracking-wide text-text-tertiary" style={font}>
                {isHost ? t("lobby.your_code") : t("lobby.joined_code")}
              </p>
              <p
                className="m-0 mt-[2px] select-all text-[30px] font-[600] leading-none tracking-[0.28em] text-text-primary"
                style={font}
              >
                {code}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-[6px]">
              {code ? <CopyCodeButton code={code} /> : null}
              <span
                className="inline-flex items-center gap-[4px] text-[11px] text-text-tertiary"
                style={font}
              >
                <span
                  className={`h-[6px] w-[6px] rounded-full ${
                    connection === "connected" ? "bg-[#12B76A]" : "bg-[#F79009]"
                  }`}
                />
                {connection === "connected"
                  ? t("lobby.connected")
                  : connection === "reconnecting"
                    ? t("lobby.reconnecting")
                    : t("lobby.connecting")}
              </span>
            </div>
          </div>

          <p className="m-0 mt-[10px] text-[12.5px] leading-snug text-text-secondary" style={font}>
            {isHost ? t("lobby.host_hint") : t("lobby.listener_hint")}
          </p>

          <div className="mt-[12px] flex items-center gap-[8px]">
            <button
              type="button"
              onClick={leaveLobby}
              className="inline-flex items-center gap-[6px] rounded-lg border-0 bg-border-alpha-14 px-[11px] py-[7px] text-[12.5px] text-text-secondary transition-colors hover:bg-[#E81123]/15 hover:text-[#E81123]"
              style={font}
            >
              <Logout2 size={14} />
              {t("lobby.leave")}
            </button>
            {!isHost ? (
              <button
                type="button"
                onClick={() => vote("skip")}
                className={`inline-flex items-center gap-[6px] rounded-lg border-0 px-[11px] py-[7px] text-[12.5px] transition-colors ${
                  votes.skip.length > 0
                    ? "bg-text-primary text-bg-primary"
                    : "bg-border-alpha-14 text-text-secondary hover:text-text-primary"
                }`}
                style={font}
              >
                {t("lobby.vote.skip")}
                {votes.skipNeeded > 0 ? ` · ${votes.skip.length}/${votes.skipNeeded}` : ""}
              </button>
            ) : null}
          </div>
        </Card>

        <PendingRequests />
        <MemberList />
        <QueueVotes />

        <Card>
          <SectionTitle>{t("lobby.server.title")}</SectionTitle>
          <Description>{t("lobby.server.description")}</Description>
          <div className="flex items-center gap-[8px]">
            <input
              type="text"
              value={serverDraft}
              onChange={(event) => setServerDraft(event.target.value)}
              onBlur={() => setServerUrl(serverDraft)}
              placeholder={t("lobby.server.placeholder")}
              className="h-[34px] min-w-0 flex-1 rounded-lg border-0 bg-border-alpha-14 px-[10px] text-[12.5px] text-text-primary outline-none placeholder:text-text-tertiary"
              style={font}
            />
            <button
              type="button"
              onClick={() => setServerUrl(serverDraft)}
              className="shrink-0 rounded-lg border-0 bg-border-alpha-14 px-[11px] py-[7px] text-[12.5px] text-text-secondary hover:text-text-primary"
              style={font}
            >
              {t("lobby.server.apply")}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  const pendingJoin = joinState === "pending" || joinState === "requesting";
  const cooling = joinState === "cooldown" && remaining !== null;

  return (
    <div className="flex flex-col gap-[10px]">
      <Card>
        <SectionTitle>{t("lobby.create.title")}</SectionTitle>
        <Description>{t("lobby.create.description")}</Description>
        <button
          type="button"
          onClick={() => createLobby()}
          className="inline-flex items-center gap-[6px] rounded-lg border-0 bg-text-primary px-[12px] py-[8px] text-[12.5px] font-[500] text-bg-primary"
          style={font}
        >
          <UsersGroupRounded size={15} />
          {t("lobby.create.action")}
        </button>
      </Card>

      <Card>
        <SectionTitle>{t("lobby.join.title")}</SectionTitle>
        <Description>{t("lobby.join.description")}</Description>
        <LobbyCodeField
          value={draftCode}
          onChange={setDraftCode}
          disabled={pendingJoin}
          onSubmit={() => joinLobby(draftCode)}
        />
        <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
          <button
            type="button"
            disabled={draftCode.length !== 4 || pendingJoin || cooling}
            onClick={() => joinLobby(draftCode)}
            className="rounded-lg border-0 bg-text-primary px-[12px] py-[7px] text-[12.5px] font-[500] text-bg-primary disabled:cursor-not-allowed disabled:opacity-40"
            style={font}
          >
            {t("lobby.join.action")}
          </button>
          {pendingJoin ? (
            <>
              <span className="text-[12px] text-text-secondary" style={font}>
                {t("lobby.join.pending")}
              </span>
              <button
                type="button"
                onClick={cancelJoin}
                className="rounded-md border-0 bg-transparent px-[6px] py-[4px] text-[12px] text-text-tertiary underline hover:text-text-primary"
                style={font}
              >
                {t("common.cancel")}
              </button>
            </>
          ) : null}
        </div>

        {joinState === "denied" ? (
          <p className="m-0 mt-[10px] text-[12px] text-[#E81123]" style={font}>
            {joinReason === "not_found"
              ? t("lobby.error.not_found")
              : joinReason === "full"
                ? t("lobby.error.full")
                : joinReason === "busy"
                  ? t("lobby.error.busy")
                  : joinReason === "host_away"
                    ? t("lobby.error.host_away")
                    : joinReason === "invalid_code"
                      ? t("lobby.error.invalid_code")
                      : t("lobby.error.generic")}
          </p>
        ) : null}

        {cooling ? (
          <p className="m-0 mt-[10px] text-[12px] text-text-secondary" style={font}>
            {t("lobby.error.cooldown", { time: formatRemaining(remaining ?? 0) })}
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t("lobby.server.title")}</SectionTitle>
        <Description>{t("lobby.server.description")}</Description>
        <div className="flex items-center gap-[8px]">
          <input
            type="text"
            value={serverDraft}
            onChange={(event) => setServerDraft(event.target.value)}
            onBlur={() => setServerUrl(serverDraft)}
            placeholder={t("lobby.server.placeholder")}
            className="h-[34px] min-w-0 flex-1 rounded-lg border-0 bg-border-alpha-14 px-[10px] text-[12.5px] text-text-primary outline-none placeholder:text-text-tertiary"
            style={font}
          />
          <button
            type="button"
            onClick={() => setServerUrl(serverDraft)}
            className="shrink-0 rounded-lg border-0 bg-border-alpha-14 px-[11px] py-[7px] text-[12.5px] text-text-secondary hover:text-text-primary"
            style={font}
          >
            {t("lobby.server.apply")}
          </button>
        </div>
      </Card>
    </div>
  );
}
