// Standalone CloudMusic lobby server.
//
//   node server/lobby/index.mjs            # listens on :4300
//   PORT=8080 LOBBY_PATH=/v1/lobby/ws node server/lobby/index.mjs
//
// No dependencies, no database: lobbies live in memory and disappear when the
// host leaves or after two idle hours. Put it behind the same hostname as the
// API (reverse proxy on /v1/lobby/ws) or point the app at it directly.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { attachWebSocketServer } from "./ws.mjs";
import { LobbyServer } from "./lobbyServer.mjs";

const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || "0.0.0.0";
const PATH = process.env.LOBBY_PATH || "/v1/lobby/ws";
const SWEEP_INTERVAL_MS = 20_000;

const lobbyServer = new LobbyServer();
const clients = new Set();

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health" || url.pathname === "/v1/lobby/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, ...lobbyServer.stats(), version: 1 }));
    return;
  }
  if (url.pathname === "/") {
    // a quick "is anything running here?" page for the Railway domain
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      [
        "CloudMusic lobby server",
        "",
        `websocket: ${PATH}`,
        `lobbies:   ${lobbyServer.stats().lobbies}`,
        `listeners: ${lobbyServer.stats().listeners}`,
        "",
        "Open CloudMusic → Einstellungen → Lobby and enter a code.",
      ].join("\n"),
    );
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("CloudMusic lobby server\n");
});

attachWebSocketServer(httpServer, {
  path: PATH,
  onConnection: (connection) => {
    const session = {
      id: randomUUID(),
      // the client sends its account id in `hello`; without one we still allow
      // a throwaway identity so the desktop app can be tested anonymously
      userId: `anon-${randomUUID()}`,
      name: "Hörer",
      send: (payload) => connection.send(payload),
    };
    lobbyServer.register(session);
    clients.add(connection);

    connection.send({ type: "hello", sessionId: session.id, serverTime: Date.now(), path: PATH });

    connection.on("message", (message) => {
      if (message.type === "hello") {
        if (typeof message.userId === "string" && message.userId.trim()) {
          session.userId = message.userId.trim().slice(0, 80);
        }
        if (typeof message.name === "string") session.name = message.name.slice(0, 40);
        connection.send({ type: "hello_ok", sessionId: session.id, serverTime: Date.now() });
        return;
      }
      lobbyServer.handle(session, message);
    });

    connection.on("close", () => {
      clients.delete(connection);
      lobbyServer.unregister(session);
    });
  },
});

const sweepTimer = setInterval(() => lobbyServer.sweep(), SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

httpServer.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[lobby] listening on ws://${HOST}:${PORT}${PATH}`);
});

function shutdown() {
  clearInterval(sweepTimer);
  for (const connection of clients) connection.close(1001);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { lobbyServer, httpServer };
