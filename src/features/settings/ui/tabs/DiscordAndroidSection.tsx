import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import { Button } from "@/shared/ui";
import type { DiscordRpcStatus } from "../../../../../electron/preload";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

function hasAndroidRpc(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.cloudMusicElectron?.discordOpenLogin === "function"
  );
}

/**
 * Android-only Discord block.
 *
 * "Mit Discord verbinden" opens an in-app browser (DiscordLoginActivity) with
 * discord.com/login. After signing in the activity takes the token straight out
 * of the page, hands it to the keystore-backed store and closes itself – no copy
 * and paste, nothing leaves the device.
 */
export function DiscordAndroidSection({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<DiscordRpcStatus>({ connected: false });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

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
      // bridge busy, the next tick retries
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    void refresh();
    // the login runs in its own activity: refresh fast while it is on screen
    // and once more when the app comes back to the foreground
    const interval = setInterval(() => void refresh(), 2000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [available, refresh]);

  const isMatch = useMemo(() => {
    const query = searchQuery?.toLowerCase().trim();
    if (!query) return true;
    const keys = [
      "settings.discord.android.title",
      "settings.discord.android.description",
      "settings.discord.android.connect",
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
      case "invalid_format":
        return t("settings.discord.android.error_invalid_token");
      case "connect_failed":
        return t("settings.discord.android.error_network");
      default:
        return code;
    }
  };

  const connect = () => {
    setFeedback(null);
    void window.cloudMusicElectron?.discordOpenLogin?.();
  };

  const clear = async () => {
    const api = window.cloudMusicElectron;
    if (!api?.discordClearToken) return;
    setBusy(true);
    try {
      const next = await api.discordClearToken();
      setStatus(next);
      setFeedback(t("settings.discord.android.cleared"));
    } finally {
      setBusy(false);
    }
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
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button
            variant="primary"
            size="sm"
            onClick={connect}
            disabled={busy}
            className="!h-[34px] !px-[14px] !text-[12.5px]"
          >
            {status.connected
              ? t("settings.discord.android.reconnect")
              : t("settings.discord.android.connect")}
          </Button>
          {status.hasToken && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void clear()}
              disabled={busy}
              className="!h-[34px] !px-[12px] !text-[12.5px]"
            >
              {t("settings.discord.android.clear")}
            </Button>
          )}
          <span className="text-[11.5px] leading-snug text-text-tertiary" style={font}>
            {statusText}
          </span>
        </div>

        <p className="m-0 text-[11.5px] leading-relaxed text-text-tertiary" style={font}>
          {t("settings.discord.android.login_hint")}
        </p>

        {feedback && (
          <p className="m-0 text-[11.5px] leading-relaxed text-text-tertiary" style={font}>
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
