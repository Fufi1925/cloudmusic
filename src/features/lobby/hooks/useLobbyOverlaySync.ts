import { useEffect } from "react";
import { usePlayerStore } from "@/features/player";
import { useModalStore } from "@/features/library/store/modalStore";
import { useLobbyStore, getLobbyUserId } from "../store/lobbyStore";
import type { LobbyOverlayState } from "../ui/LobbyOverlayPanel";

/**
 * Desktop only: mirrors the lobby into the small always-on-top card.
 *
 * The overlay lives in its own BrowserWindow, so it cannot read the zustand
 * stores – this hook pushes a plain snapshot over IPC and turns the card's
 * actions (kick, open lobby, …) back into store calls.
 */
export function useLobbyOverlaySync(): void {
  useEffect(() => {
    const api = window.cloudMusicElectron;
    if (!api?.lobbyOverlayUpdateState) return;

    const push = () => {
      const lobby = useLobbyStore.getState();
      const player = usePlayerStore.getState();
      const playback = lobby.playback;
      const queue = playback?.queue?.length ? playback.queue : player.queue;
      const index = playback?.queue?.length ? playback.index : player.currentIndex;
      const currentTrack = playback?.track ?? player.currentTrack;

      const payload: LobbyOverlayState = {
        active: lobby.role !== null,
        role: lobby.role,
        code: lobby.code,
        hostName: lobby.hostName,
        meId: getLobbyUserId(),
        members: lobby.members.map((member) => ({
          userId: member.userId,
          name: member.name,
          online: member.online,
        })),
        current: currentTrack
          ? {
              title: currentTrack.title,
              artists: currentTrack.artists,
              coverUrl: currentTrack.coverUrl ?? null,
            }
          : null,
        next: (queue ?? []).slice(index + 1, index + 4).map((track) => ({
          id: track.id,
          title: track.title,
          artists: track.artists,
        })),
        requests: lobby.requests.map((request) => ({
          id: request.id,
          title: request.track.title,
          name: request.name,
          votes: request.voteCount,
        })),
        votes: { skip: lobby.votes.skip.length, skipNeeded: lobby.votes.skipNeeded },
      };

      api.lobbyOverlayUpdateState?.(payload);
    };

    push();
    const offLobby = useLobbyStore.subscribe(push);
    const offPlayer = usePlayerStore.subscribe(push);

    return () => {
      offLobby();
      offPlayer();
      api.lobbyOverlayUpdateState?.({
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
      });
    };
  }, []);

  useEffect(() => {
    const api = window.cloudMusicElectron;
    if (!api?.onLobbyOverlayAction) return;

    const cleanup = api.onLobbyOverlayAction((action: { type?: string; userId?: string }) => {
      if (!action?.type) return;
      if (action.type === "kick" && action.userId) {
        useLobbyStore.getState().kickMember(action.userId);
        return;
      }
      if (action.type === "openLobby") {
        useModalStore.getState().openSettings();
      }
    });

    return cleanup;
  }, []);
}
