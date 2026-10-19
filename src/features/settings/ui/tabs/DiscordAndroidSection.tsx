import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import { Button } from "@/shared/ui";
import type { DiscordRpcStatus } from "../../../../../electron/preload";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

function hasAndroidRpc(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.cloudMusicElectron?.discordSetToken === "function"
  );
}

/**
 * Android-only "custom RPC" block: phones have no Discord IPC socket, so the
 * native side signs into Discord's gateway with the user's token. The token is
 * typed/pasted here, handed to the keystore-backed store and never sent back to
 * the UI again.
 */
export function DiscordAndroidSection({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<DiscordRpcStatus>({ connected: false });
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState(false);

  useEffect(() => {
    setAvailable(hasAndroidRpc());
  }, []);

  const refresh = useCallback(async () => {
    const api = window.cloudMusicElectron;
    if (!api?.getDiscordStatus) return;
    try {
      const next = await api.getDiscordStatus();
      if (next) setStatus(next);
    } catch {
      // bridge busy, try again on the next tick
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [available, refresh]);

  const isMatch = useMemo(() => {
    const query = searchQuery?.toLowerCase().trim();
    if (!query) return true;
    const keys = [
      "settings.discord.android.title",
      "settings.discord.android.description",
      "settings.discord.android.token_label",
      "settings.discord.android.warning",
    ];
    return keys.some((key) =>
      getTranslationsForAllLocales(key).some((text) => text.toLowerCase().includes(query)),
    );
  }, [searchQuery]);

  if (!available || !isMatch) return null;

  const errorText = (code: string | undefined) => {
    switch (code) {
      case "invalid_token":
        return t("settings.discord.android.error_invalid_token");
      case "connect_failed":
        return t("settings.discord.android.error_network");
      case "invalid_format":
        return t("settings.discord.android.error_invalid_token");
      default:
        return code;
    }
  };

  const save = async () => {
    const api = window.cloudMusicElectron;
    const token = tokenInput.trim();
    if (!api?.discordSetToken || token.length < 20) {
      setFeedback(t("settings.discord.android.error_invalid_token"));
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const next = await api.discordSetToken(token);
      setStatus(next);
      setTokenInput("");
      setFeedback(
        next?.error
          ? errorText(next.error) || t("settings.discord.android.error_invalid_token")
          : t("settings.discord.android.saved"),
      );
    } catch {
      setFeedback(t("settings.discord.android.error_connect_failed"));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const api = window.cloudMusicElectron;
    if (!api?.discordClearToken) return;
    setBusy(true);
    try {
      const next = await api.discordClearToken();
      setStatus(next);
      setFeedback(t("settings.discord.android.no_token"));
    } finally {
      setBusy(false);
    }
  };

  const openLogin = () => {
    void window.cloudMusicElectron?.discordOpenLogin?.();
  };

  const statusText = status.error
    ? errorText(status.error)
    : status.connected
      ? t("settings.discord.android.connected_as", { user: status.username || "Discord" })
      : status.hasToken
        ? t("settings.discord.android.connecting")
        : t("settings.discord.android.no_token");

  return (
    <div className="flex flex-col gap-[12px] rounded-lg border border-border-primary/60 bg-border-alpha-10 p-[14px]">
      <div className="flex items-start justify-between gap-[10px]">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-[13.5px] font-[600] text-text-primary" style={font}>
            {t("settings.discord.android.title")}
          </span>
          <span className="text-[12.5px] leading-relaxed text-text-tertiary" style={font}>
            {t("settings.discord.android.description")}
          </span>
        </div>
        <span
          className={`mt-[2px] inline-flex shrink-0 items-center gap-[6px] rounded-full px-[9px] py-[4px] text-[11px] font-[500] ${
            status.connected
              ? "bg-[#23a55a]/15 text-[#1f8f4e]"
              : "bg-border-alpha-14 text-text-tertiary"
          }`}
          style={font}
        >
          <span
            className={`h-[6px] w-[6px] rounded-full ${
              status.connected ? "bg-[#23a55a]" : "bg-text-tertiary/50"
            }`}
          />
          {status.connected ? "RPC" : "Offline"}
        </span>
      </div>

      <div
        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-[10px] py-[8px] text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300"
        style={font}
      >
        {t("settings.discord.android.warning")}
      </div>

      <div className="flex flex-col gap-[8px]">
        <div className="flex items-center gap-[8px]">
          <Button
            variant="secondary"
            size="sm"
            onClick={openLogin}
            className="!h-[32px] !px-[12px] !text-[12.5px]"
          >
            {t("settings.discord.android.open_login")}
          </Button>
          <span className="text-[11.5px] leading-snug text-text-tertiary" style={font}>
            {statusText}
          </span>
        </div>

        <p className="m-0 text-[11.5px] leading-relaxed text-text-tertiary" style={font}>
          {t("settings.discord.android.howto")}
        </p>

        <label className="flex flex-col gap-[4px]">
          <span className="text-[12px] font-[500] text-text-secondary" style={font}>
            {t("settings.discord.android.token_label")}
          </span>
          <div className="flex items-center gap-[6px]">
            <input
              type={revealToken ? "text" : "password"}
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder={t("settings.discord.android.token_placeholder")}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="h-[36px] min-w-0 flex-1 rounded-md border border-border-primary/60 bg-bg-surface px-[10px] font-mono text-[12px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-secondary"
            />
            <button
              type="button"
              onClick={() => setRevealToken((value) => !value)}
              className="h-[36px] shrink-0 rounded-md border-0 bg-border-alpha-14 px-[10px] text-[12px] text-text-secondary"
              style={font}
            >
              {revealToken ? "•••" : "👁"}
            </button>
          </div>
        </label>

        <div className="flex items-center gap-[8px]">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            disabled={busy || tokenInput.trim().length < 20}
            className="!h-[32px] !px-[14px] !text-[12.5px]"
          >
            {t("settings.discord.android.save")}
          </Button>
          {status.hasToken && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void clear()}
              disabled={busy}
              className="!h-[32px] !px-[12px] !text-[12.5px]"
            >
              {t("settings.discord.android.clear")}
            </Button>
          )}
        </div>

        {feedback && (
          <p
            className={`m-0 text-[11.5px] leading-relaxed ${
              feedback === t("settings.discord.android.saved")
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-text-tertiary"
            }`}
            style={font}
          >
            {feedback}
          </p>
        )}

        <p className="m-0 text-[11px] leading-relaxed text-text-tertiary" style={font}>
          {t("settings.discord.android.stored_locally")}
        </p>
      </div>
    </div>
  );
}

export default DiscordAndroidSection;
