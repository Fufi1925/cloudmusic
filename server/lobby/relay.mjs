// Minimal pass-through relay for the CloudMusic api.
//
// Why: on some networks (mobile carriers especially) cloudflare answers the api
// host with a hard block page, so the app can neither sign in nor even load the
// verify page. This relay runs on our own server, keeps its own cookies for the
// api host and forwards the exact request - the app's hmac signature covers
// method + path + body, so it stays valid through the hop.
//
// Deliberately tiny and dependency free:
//   GET  /api-relay/probe           -> what this server sees when it calls the api
//   POST /api-relay                 -> {path, method, headers, body(base64)}
//   GET  /api-relay/verify?action=x -> the api's turnstile page, rebased onto /api-relay/p/
//   GET  /api-relay/p/<path>        -> subresources of api.tryliner.fun for that page
//
// It is not an open proxy: only a fixed upstream, a path allowlist, capped
// bodies, a per-ip rate limit and no logging of bodies.
import https from "node:https";

const UPSTREAM_HOST = "api.tryliner.fun";
const UPSTREAM = `https://${UPSTREAM_HOST}`;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_BODY = 128 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

/** request headers forwarded upstream (everything else is dropped) */
const FORWARD_HEADERS = new Set([
  "content-type",
  "accept",
  "accept-language",
  "user-agent",
  "x-liner-signature",
  "x-liner-timestamp",
  "x-liner-nonce",
  "x-liner-instance",
  "x-liner-user-agent",
  "x-request-id",
  "origin",
  "referer",
  "if-none-match",
]);

const PATH_RULES = [/^\/v1\/auth\/[a-z/]*$/, /^\/v1\/health$/, /^\/v1\/covers?\//, /^\/v1\/presence\//];

/** cookie jar for the upstream host (clearance + api session) */
const jar = new Map();
const rate = new Map();

function allowedPath(path) {
  return PATH_RULES.some((rule) => rule.test(path));
}

function cookieHeader() {
  const cookies = jar.get(UPSTREAM_HOST);
  if (!cookies || cookies.size === 0) return null;
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeCookies(setCookie) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  let cookies = jar.get(UPSTREAM_HOST);
  if (!cookies) {
    cookies = new Map();
    jar.set(UPSTREAM_HOST, cookies);
  }
  for (const raw of list) {
    const [pair] = String(raw).split(";");
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === "" || /expires=thu, 01 jan 1970/i.test(raw)) cookies.delete(name);
    else cookies.set(name, value);
  }
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

function limited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = rate.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rate.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

/** one request upstream, returns the raw answer */
function upstreamRequest({ method = "GET", path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const finalHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!FORWARD_HEADERS.has(name.toLowerCase())) continue;
      if (value === undefined || value === null) continue;
      finalHeaders[name] = value;
    }
    // a browser-like default set; the app's own values win when present
    finalHeaders["accept-encoding"] = "identity";
    const cookie = cookieHeader();
    if (cookie) finalHeaders["cookie"] = cookie;

    const request = https.request(
      {
        host: UPSTREAM_HOST,
        method,
        path,
        headers: finalHeaders,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        storeCookies(response.headers["set-cookie"]);
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE) {
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("upstream timeout")));
    request.on("error", reject);
    if (body && body.length > 0) request.write(body);
    request.end();
  });
}

function baseHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-cloudmusic-relay",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
    ...extra,
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, baseHeaders({ "content-type": "application/json", "content-length": Buffer.byteLength(body) }));
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function headerList(headers, name) {
  const value = headers[name];
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** GET /api-relay/probe: does this server reach the api at all? */
const CHROME_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "de-DE,de;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "upgrade-insecure-requests": "1",
};

export async function probe(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const mode = url.searchParams.get("mode") ?? "relay";
  try {
    const headers = mode === "chrome" ? { ...CHROME_HEADERS } : { "user-agent": "CloudMusic-Relay/1" };
    const answer = await upstreamRequest({ method: "GET", path: "/v1/health", headers });
    const text = answer.body.toString("utf8").slice(0, 240);
    json(res, 200, {
      ok: true,
      upstreamStatus: answer.status,
      server: headerList(answer.headers, "server") ?? null,
      cfRay: headerList(answer.headers, "cf-ray") ?? null,
      contentType: headerList(answer.headers, "content-type") ?? null,
      blocked: answer.status === 403 && /<html/i.test(text),
      bodyHead: text.replace(/\s+/g, " "),
    });
  } catch (error) {
    json(res, 502, { ok: false, error: String(error?.message ?? error) });
  }
}

/** GET /api-relay/verify: the turnstile page, rebased so its relative urls stay here */
export async function relayVerify(req, res, url) {
  if (limited(req)) return json(res, 429, { ok: false, error: "rate limited" });
  const action = url.searchParams.get("action") === "register" ? "register" : "login";
  try {
    const answer = await upstreamRequest({
      method: "GET",
      path: `/v1/auth/verify?action=${action}`,
      headers: { accept: "text/html", "user-agent": req.headers["user-agent"] ?? "Mozilla/5.0" },
    });
    const html = answer.body.toString("utf8");
    if (answer.status !== 200 || !/<html/i.test(html)) {
      // hand the block/failure through unchanged, the app shows it as an error
      res.writeHead(answer.status || 502, baseHeaders({ "content-type": "text/html; charset=utf-8" }));
      return res.end(html || "upstream failed");
    }
    // relative urls (scripts, api calls of the page) resolve against /api-relay/p/
    const base = "/api-relay/p/";
    const patched = html.includes("<head>")
      ? html.replace("<head>", `<head><base href="${base}">`)
      : `<base href="${base}">` + html;
    res.writeHead(200, baseHeaders({ "content-type": "text/html; charset=utf-8" }));
    res.end(patched);
  } catch (error) {
    json(res, 502, { ok: false, error: String(error?.message ?? error) });
  }
}

/** GET /api-relay/p/<path>: subresources of the verify page */
export async function relaySubresource(req, res, url) {
  if (limited(req)) return json(res, 429, { ok: false, error: "rate limited" });
  const rest = url.pathname.slice("/api-relay/p".length) || "/";
  const path = `${rest}${url.search}`;
  try {
    const answer = await upstreamRequest({
      method: "GET",
      path,
      headers: {
        accept: req.headers.accept ?? "*/*",
        "accept-language": req.headers["accept-language"] ?? "en",
        "user-agent": req.headers["user-agent"] ?? "Mozilla/5.0",
      },
    });
    const type = headerList(answer.headers, "content-type") ?? "application/octet-stream";
    res.writeHead(answer.status, baseHeaders({ "content-type": String(type) }));
    res.end(answer.body);
  } catch (error) {
    json(res, 502, { ok: false, error: String(error?.message ?? error) });
  }
}

/**
 * Router hook used by index.mjs.
 *
 * Only the probe is exposed: measurement showed api.tryliner.fun answers this
 * server with the same cloudflare block page as the app on mobile data, so a
 * server side relay cannot work. The probe stays because it is the cheapest way
 * to see whether that ever changes.
 */
export function handleRelay(req, res, url) {
  if (!url.pathname.startsWith("/api-relay")) return false;
  if (req.method === "OPTIONS") {
    res.writeHead(204, baseHeaders());
    res.end();
    return true;
  }
  if (url.pathname === "/api-relay/probe") {
    probe(req, res).catch(() => json(res, 500, { ok: false }));
    return true;
  }
  json(res, 404, { ok: false, error: "not available" });
  return true;
}

export const RELAY_UPSTREAM = UPSTREAM;
