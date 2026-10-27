// Minimal RFC 6455 server-side WebSocket implementation.
//
// The lobby server has to run next to the app with `node server/lobby/index.mjs`
// (Railway, a VPS, a Raspberry Pi …), so it deliberately has no dependencies:
// handshake, text frames, ping/pong and close are all implemented here.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
};

/** Sec-WebSocket-Accept value for a client key */
export function acceptKey(key) {
  return createHash("sha1").update(String(key) + GUID).digest("base64");
}

/** build one unmasked server frame */
export function encodeFrame(payload, opcode = OPCODE.text) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

/**
 * Pull as many complete frames out of `buffer` as possible.
 * Returns the decoded frames plus the not-yet-complete remainder.
 */
export function decodeFrames(buffer) {
  const frames = [];
  let rest = buffer;
  for (;;) {
    if (rest.length < 2) break;
    const first = rest[0];
    const second = rest[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (rest.length < 4) break;
      len = rest.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (rest.length < 10) break;
      const big = rest.readBigUInt64BE(2);
      if (big > BigInt(16 * 1024 * 1024)) throw new Error("frame too large");
      len = Number(big);
      offset = 10;
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (rest.length < offset + len) break;

    let payload = rest.subarray(offset, offset + len);
    if (masked) {
      const mask = rest.subarray(maskOffset, maskOffset + 4);
      const copy = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i += 1) copy[i] = payload[i] ^ mask[i & 3];
      payload = copy;
    }
    frames.push({ fin, opcode, payload });
    rest = rest.subarray(offset + len);
  }
  return { frames, rest };
}

/** One connected client: emits "message" (parsed JSON), "raw", "close" */
export class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.closed = false;
    this.fragments = [];
    this.fragmentOpcode = null;
    this.buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("close", () => this.onClose());
    socket.on("error", () => this.onClose());
  }

  send(payload) {
    if (this.closed) return;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    try {
      this.socket.write(encodeFrame(text, OPCODE.text));
    } catch {
      this.onClose();
    }
  }

  ping() {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame("", OPCODE.ping));
    } catch {
      this.onClose();
    }
  }

  close(code = 1000) {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    try {
      this.socket.write(encodeFrame(payload, OPCODE.close));
      this.socket.end();
    } catch {}
    this.onClose();
  }

  private_onCloseGuarded = false;

  onClose() {
    if (this.private_onCloseGuarded) return;
    this.private_onCloseGuarded = true;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch {}
    this.emit("close");
  }

  onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    let parsed;
    try {
      parsed = decodeFrames(this.buffer);
    } catch {
      this.close(1009);
      return;
    }
    this.buffer = parsed.rest;

    for (const frame of parsed.frames) {
      if (frame.opcode === OPCODE.ping) {
        try {
          this.socket.write(encodeFrame(frame.payload, OPCODE.pong));
        } catch {}
        continue;
      }
      if (frame.opcode === OPCODE.pong) continue;
      if (frame.opcode === OPCODE.close) {
        this.close(1000);
        return;
      }
      if (frame.opcode === OPCODE.continuation) {
        this.fragments.push(frame.payload);
        if (!frame.fin) continue;
        const full = Buffer.concat(this.fragments);
        this.fragments = [];
        this.emitFrame(this.fragmentOpcode ?? OPCODE.text, full);
        continue;
      }
      if (!frame.fin) {
        this.fragmentOpcode = frame.opcode;
        this.fragments = [frame.payload];
        continue;
      }
      this.emitFrame(frame.opcode, frame.payload);
    }
  }

  emitFrame(opcode, payload) {
    if (opcode !== OPCODE.text) return;
    const text = payload.toString("utf8");
    this.emit("raw", text);
    try {
      this.emit("message", JSON.parse(text));
    } catch {
      this.send({ type: "error", code: "bad_json", message: "Message is not valid JSON" });
    }
  }
}

/**
 * Attach a WebSocket endpoint to an existing http.Server.
 * Only the upgrade path (default `/v1/lobby/ws`) is accepted.
 */
export function attachWebSocketServer(server, { path = "/v1/lobby/ws", onConnection }) {
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (req.headers.upgrade?.toLowerCase() !== "websocket" || !key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey(key)}`,
        "\r\n",
      ].join("\r\n"),
    );
    socket.setNoDelay(true);
    onConnection(new WsConnection(socket));
  });
}
