# CloudMusic lobby server

Dependency-free WebSocket server for *Lobby / Listen together*.
Rooms live in memory; a lobby disappears when the host leaves (after a 60 s
grace) or after two idle hours.

```
node server/lobby/index.mjs          # ws://0.0.0.0:4300/v1/lobby/ws
```

| env          | default          | meaning                          |
| ------------ | ---------------- | -------------------------------- |
| `PORT`       | `4300`           | HTTP/WebSocket port              |
| `HOST`       | `0.0.0.0`        | bind address                     |
| `LOBBY_PATH` | `/v1/lobby/ws`   | websocket upgrade path           |

`GET /health` (also `/v1/lobby/health`) returns
`{"ok":true,"lobbies":0,"sessions":0,"listeners":0,"version":1}` – useful as a
Railway health check.

## Railway

The repository already contains `railway.json` and a `Dockerfile` (plus a
`nixpacks.toml` fallback), so Railway skips the desktop build entirely
(nothing to install) and only starts the server:

1. Railway → **New Project → Deploy from GitHub repo** → this repository.
2. Service name **`cloudmusic`** → domain `cloudmusic.up.railway.app`.
3. **Networking → Generate Domain**, then check `/health`.
4. The app's default lobby address is `wss://cloudmusic.up.railway.app/v1/lobby/ws`.
   If Railway hands out another hostname, either rename the service or set
   `VITE_LOBBY_URL` at build time, or just paste the address into
   *Einstellungen → Lobby → Lobby-Server*.

## Protocol (short version)

Client → server: `hello`, `ping`, `create_lobby`, `join_request`, `approve`,
`deny`, `leave`, `resume`, `vote`, `request_track`, `vote_request`,
`withdraw_request`, `answer_request`, `kick`, `playback`, `lobby_settings`.
Server → client: `hello`, `hello_ok`, `pong`, `lobby_state`, `welcome`,
`members`, `playback`, `votes`, `requests`, `request_accepted`,
`request_denied`, `kicked`, `join_pending`, `join_request`,
`join_request_resolved`, `join_denied`, `skip_passed`, `lobby_closed`,
`resume_failed`, `left`, `error`.

Rules that matter:

* 4-digit codes, never starting with `0`; a code is only valid while the host is
  in the room.
* a guest needs the host's approval; after a deny the same account is blocked
  for 5 minutes.
* only the host may send `playback`; a listener's own transport buttons are
  locked client-side.
* skips need a majority of the online listeners (1 listener → 1 vote); a vote
  belongs to the track it was cast for and survives the host's one-second
  position updates – it only resets when the room really moves on.
* listeners may wish for songs (`request_track`, max 20 open, 30 min TTL);
  everybody can support a wish (`vote_request`), only the host answers it
  (`answer_request`). An accepted wish is appended to the host's queue, a denied
  one simply disappears.
* the host may `kick` a listender; the guest gets `kicked` and a 5 minute cooldown.
* audio is never proxied – each client resolves and plays the track itself.

Tests: `node --test server/lobby/lobbyServer.test.mjs`.
