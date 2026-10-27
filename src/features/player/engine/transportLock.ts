/**
 * When you are listening in a lobby the host owns the transport, so local
 * play/pause/seek/skip commands have to be ignored. The engine asks this tiny
 * module (instead of importing the lobby) to stay free of circular imports.
 */
let locked = false;

export function setTransportLocked(next: boolean): void {
  locked = next;
}

export function isTransportLocked(): boolean {
  return locked;
}
