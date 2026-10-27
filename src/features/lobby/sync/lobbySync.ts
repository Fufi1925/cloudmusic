import { playerEngine, usePlayerStore } from "@/features/player";
import { setTransportLocked } from "@/features/player/engine/transportLock";
import { lobbyClient } from "@/shared/lobby";
import type { LobbyClientMessage, LobbyPlayback, LobbyServerMessage, Track } from "@/shared/lobby";
import { useLobbyStore } from "../store/lobbyStore";
import { isNoopPlan, planLobbySync } from "./lobbySyncMath";

/** how often the host re-sends its position while playing */
const HOST_PUBLISH_INTERVAL_MS = 1_000;
/** how often a listener re-checks its drift between host updates */
const LISTENER_TICK_INTERVAL_MS = 2_500;

let started = false;
let cleanups: Array<() => void> = [];
let hostTimer: ReturnType<typeof setInterval> | null = null;
let listenerTimer: ReturnType<typeof setInterval> | null = null;
let applyingRemote = false;
let lastPublishKey = "";
let lastPublishAt = 0;

function hostPayload(): Extract<LobbyClientMessage, { type: "playback" }> {
  const player = usePlayerStore.getState();
  return {
    type: "playback",
    track: player.currentTrack,
    queue: player.queue,
    index: player.currentIndex,
    positionMs: player.positionMs,
    status: player.status === "playing" ? "playing" : "paused",
  };
}

/** push the current transport state to the room (host only) */
export function publishHostPlayback(force = false): void {
  const lobby = useLobbyStore.getState();
  if (lobby.role !== "host") return;

  const payload = hostPayload();
  const key = `${payload.track?.id ?? "-"}|${payload.status}|${payload.index}|${payload.queue.length}`;
  const now = Date.now();
  if (!force && key === lastPublishKey && now - lastPublishAt < HOST_PUBLISH_INTERVAL_MS) {
    return;
  }
  // always send on a real change (track, play state, queue) …
  if (!force && key !== lastPublishKey) {
    lastPublishKey = key;
    lastPublishAt = now;
    lobbyClient.send(payload);
    return;
  }
  // … and otherwise just keep the ticking position fresh
  if (now - lastPublishAt < HOST_PUBLISH_INTERVAL_MS) return;
  lastPublishKey = key;
  lastPublishAt = now;
  lobbyClient.send(payload);
}

/** make the local player match what the host is doing */
async function applyRemotePlayback(playback: LobbyPlayback): Promise<void> {
  if (applyingRemote) return;
  if (useLobbyStore.getState().role !== "listener") return;

  const player = usePlayerStore.getState();
  const plan = planLobbySync(
    {
      trackId: player.currentTrack?.id ?? null,
      positionMs: player.positionMs,
      status: player.status,
    },
    playback,
    lobbyClient.serverNow(),
  );
  if (isNoopPlan(plan)) return;

  applyingRemote = true;
  try {
    if (plan.switchTrack && playback.track) {
      const queue = playback.queue.length > 0 ? playback.queue : [playback.track];
      const index = Math.min(Math.max(0, playback.index), queue.length - 1);
      const track = queue[index] ?? playback.track;
      // the room's order matters, the listener's shuffle flag must not reshuffle it
      const shuffle = usePlayerStore.getState().shuffle;
      if (shuffle) usePlayerStore.getState().setShuffle(false);
      try {
        await playerEngine.playTrack(track, queue, null, null, index, false);
      } finally {
        if (shuffle) usePlayerStore.getState().setShuffle(true);
      }
    }
    if (plan.seekTo !== null) playerEngine.seek(plan.seekTo);
    if (plan.pause) playerEngine.pause();
    else if (plan.play) playerEngine.resume();
  } catch {
    /* a failed load is retried by the next sync tick */
  } finally {
    applyingRemote = false;
  }
}

/** append a wish the host just accepted to the room's queue */
async function queueAcceptedRequest(track: Track): Promise<void> {
  const player = usePlayerStore.getState();
  const queue = player.queue ?? [];
  if (queue.some((entry) => entry.id === track.id)) {
    publishHostPlayback(true);
    return;
  }
  const nextQueue = [...queue, track];
  usePlayerStore.getState().setQueue(nextQueue);
  if (!player.currentTrack) {
    // nothing is playing yet – start with the wish so the room hears something
    try {
      await playerEngine.playTrack(track, nextQueue, null, null, nextQueue.length - 1, false);
    } catch {
      /* the engine reports the failure itself */
    }
  }
  publishHostPlayback(true);
}

function handleServerMessage(message: LobbyServerMessage): void {
  const wasHost = useLobbyStore.getState().role === "host";
  useLobbyStore.getState().handleServerMessage(message);

  if (message.type === "playback") {
    void applyRemotePlayback(message);
    return;
  }

  if (message.type === "request_accepted") {
    // the host accepted a wish: it goes to the end of the room's queue
    if (useLobbyStore.getState().role === "host") {
      void queueAcceptedRequest(message.track);
    }
    return;
  }

  if (message.type === "skip_passed" && wasHost) {
    // enough listeners voted – the host's app performs the skip for everyone
    void playerEngine.skipNext();
    return;
  }

  if (message.type === "lobby_state" || message.type === "welcome") {
    if (message.role === "listener") {
      void applyRemotePlayback(message.playback);
    } else {
      lastPublishKey = "";
      lastPublishAt = 0;
      publishHostPlayback(true);
    }
  }
}

function handleReconnect(): void {
  const lobby = useLobbyStore.getState();
  if (lobby.code && lobby.role) {
    lobbyClient.send({ type: "resume", code: lobby.code });
    if (lobby.role === "host") publishHostPlayback(true);
    return;
  }
  if (lobby.code && (lobby.joinState === "pending" || lobby.joinState === "requesting")) {
    lobbyClient.send({ type: "join_request", code: lobby.code });
  }
}

/** start the bridge between the player and the lobby socket (idempotent) */
export function startLobbySync(): void {
  if (started) return;
  started = true;

  cleanups.push(lobbyClient.onMessage(handleServerMessage));
  cleanups.push(
    lobbyClient.onState((state) => useLobbyStore.getState().handleConnectionState(state)),
  );
  lobbyClient.onReconnect = handleReconnect;

  // the store restored a room from the last session: reconnect and re-attach.
  // `send` parks the resume in the outbox, which is replayed right after `hello`.
  const restoredLobby = useLobbyStore.getState();
  if (restoredLobby.role && restoredLobby.code) {
    lobbyClient.setUrl(restoredLobby.serverUrl);
    lobbyClient.start(restoredLobby.serverUrl);
    lobbyClient.send({ type: "resume", code: restoredLobby.code });
  }

  // host: mirror every transport change into the room
  const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
    if (useLobbyStore.getState().role !== "host") return;
    if (
      state.currentTrack?.id !== previous.currentTrack?.id ||
      state.status !== previous.status ||
      state.queue !== previous.queue ||
      state.currentIndex !== previous.currentIndex
    ) {
      publishHostPlayback(true);
    }
  });

  // host: keep the position ticking so a listener joining mid-song lands right
  hostTimer = setInterval(() => {
    if (useLobbyStore.getState().role === "host") publishHostPlayback();
  }, HOST_PUBLISH_INTERVAL_MS);

  // listener: keep an eye on the drift between updates
  listenerTimer = setInterval(() => {
    const lobby = useLobbyStore.getState();
    if (lobby.role !== "listener" || !lobby.playback) return;
    void applyRemotePlayback(lobby.playback);
  }, LISTENER_TICK_INTERVAL_MS);

  // listeners must not steer the transport
  const unsubscribeLobby = useLobbyStore.subscribe((state, previous) => {
    if (state.role === previous.role) return;
    setTransportLocked(state.role === "listener");
    if (state.role === "host") publishHostPlayback(true);
  });
  setTransportLocked(useLobbyStore.getState().role === "listener");

  cleanups.push(unsubscribePlayer, unsubscribeLobby);
}

export function stopLobbySync(): void {
  if (!started) return;
  started = false;
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  if (hostTimer) clearInterval(hostTimer);
  if (listenerTimer) clearInterval(listenerTimer);
  hostTimer = null;
  listenerTimer = null;
  lobbyClient.onReconnect = null;
  setTransportLocked(false);
}
