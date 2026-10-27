import { useEffect } from "react";
import { useTranslation } from "@/languages";
import { showToast } from "@/shared/ui";
import { useLobbyStore } from "../store/lobbyStore";
import { startLobbySync, stopLobbySync } from "../sync/lobbySync";

/** mounts the lobby ↔ player bridge for the lifetime of the app */
export function useLobbySync(): void {
  const { t } = useTranslation();
  const notice = useLobbyStore((state) => state.notice);

  useEffect(() => {
    startLobbySync();
    return () => stopLobbySync();
  }, []);

  useEffect(() => {
    if (!notice) return;
    showToast(t(notice.key), "info");
    useLobbyStore.getState().setNotice(null);
  }, [notice, t]);
}
