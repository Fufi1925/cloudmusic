// Node re-implementation of the android native layer for desktop testing of the
// WebView side (liner-android.js + the unchanged renderer) in headless chromium.
// Mirrors NetProxy.java / ElectronHeaders.java / AssetServer.java rule by rule.
import fs from "node:fs";
import path from "node:path";

export const APP_HOST = "appassets.androidplatform.net";
export const APP_ORIGIN = `https://${APP_HOST}`;
export const TUNNEL_PATH = "/__liner_net__/";
const META = "x-lnrproxy-";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
const TUNNEL_SKIP = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "te", "trailer", "upgrade", "keep-alive", "proxy-connection", "expect", "cookie", "cookie2"]);
const SUB_SKIP = new Set([...TUNNEL_SKIP, "origin", "referer", "if-none-match", "if-modified-since"]);

// ElectronHeaders.java
export function matchesFilter(url) {
  const host = new URL(url).hostname.toLowerCase();
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "googlevideo.com" || host.endsWith(".googlevideo.com") || host === "api.music.apple.com" || host === "amp-api.music.apple.com";
}

export function originFor(url) {
  if (url.includes("music.apple.com/")) return "https://music.apple.com";
  if (url.includes("://www.youtube.com/")) return "https://www.youtube.com";
  return "https://music.youtube.com";
}

function rewrite(url, headers) {
  if (!matchesFilter(url)) return new Map(headers);
  const out = new Map(headers);
  const ua = out.get("x-liner-user-agent");
  out.delete("x-liner-user-agent");
  out.delete("origin");
  out.delete("referer");
  const origin = originFor(url);
  out.set("origin", origin);
  out.set("referer", `${origin}/`);
  if (ua) out.set("user-agent", ua);
  return out;
}

export const stats = { tunnel: 0, subresource: 0, preflight: 0, errors: [], rewritten: 0, hosts: new Map() };

// OkHttp semantics: redirects followed per hop with the network interceptor applied each time
async function execute({ url, method, headers, body, redirect }) {
  let current = url;
  let currentMethod = method;
  let currentBody = body;
  let hdrs = new Map(headers);
  let redirected = false;
  for (let hop = 0; hop < 20; hop += 1) {
    const hopHeaders = rewrite(current, hdrs);
    if (matchesFilter(current)) stats.rewritten += 1;
    const host = new URL(current).hostname;
    stats.hosts.set(host, (stats.hosts.get(host) ?? 0) + 1);
    const res = await fetch(current, {
      method: currentMethod,
      headers: Object.fromEntries(hopHeaders),
      body: currentBody,
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(res.status) && redirect === "follow") {
      const location = res.headers.get("location");
      if (!location) return { res, url: current, redirected };
      const next = new URL(location, current).href;
      await res.arrayBuffer().catch(() => undefined);
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
        currentMethod = "GET";
        currentBody = undefined;
        hdrs.delete("content-type");
      }
      if (new URL(next).host !== new URL(current).host) hdrs.delete("authorization");
      current = next;
      redirected = true;
      continue;
    }
    return { res, url: current, redirected };
  }
  throw new Error("too many redirects");
}

function copyHeaders(res, dropCors) {
  const out = {};
  res.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "set-cookie" || lower === "content-type") return;
    // node's fetch decodes gzip/br like OkHttp's transparent gzip
    if (lower === "content-encoding" || lower === "content-length") return;
    if (dropCors && lower.startsWith("access-control-")) return;
    out[lower] = value;
  });
  return out;
}

const allowedWebStatus = (code) => (code >= 100 && code <= 299) || (code >= 400 && code <= 599);

export class NativeSim {
  constructor({ wwwDir, userAgent, acceptLanguage = "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7", apiMock = null }) {
    this.wwwDir = wwwDir;
    this.userAgent = userAgent;
    this.acceptLanguage = acceptLanguage;
    this.pending = new Map();
    this.apiMock = apiMock;
  }

  // LinerNet.prepare (the harness page calls it through a synchronous XHR)
  prepare(id, descriptor, bodyBase64) {
    this.pending.set(id, { descriptor, body: bodyBase64 ? Buffer.from(bodyBase64, "base64") : null });
  }

  async route(route) {
    const request = route.request();
    const url = new URL(request.url());
    try {
      if (url.hostname === APP_HOST) {
        if (url.pathname === "/__harness_prepare__") {
          const { id, descriptor, body } = JSON.parse(request.postData() || "{}");
          this.prepare(id, JSON.parse(descriptor), body);
          return route.fulfill({ status: 204, body: "" });
        }
        if (url.pathname.startsWith(TUNNEL_PATH)) return await this.tunnel(route, url.pathname.slice(TUNNEL_PATH.length));
        return this.asset(route, url.pathname);
      }
      if (url.protocol === "http:" || url.protocol === "https:") return await this.subresource(route);
      return route.continue();
    } catch (error) {
      stats.errors.push(`${request.method()} ${request.url()}: ${error}`);
      return route.abort();
    }
  }

  asset(route, pathname) {
    const clean = pathname === "/" || !pathname ? "/index.html" : pathname.split("/").filter((s) => s && s !== "..").map((s) => "/" + s).join("");
    const file = path.join(this.wwwDir, clean);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
    const ext = path.extname(file).slice(1);
    const types = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", wasm: "application/wasm", woff2: "font/woff2" };
    return route.fulfill({ status: 200, headers: { "content-type": types[ext] ?? "application/octet-stream", "cache-control": "no-cache" }, body: fs.readFileSync(file) });
  }

  // NetProxy.handleTunnel
  async tunnel(route, id) {
    stats.tunnel += 1;
    const parked = this.pending.get(id);
    this.pending.delete(id);
    if (!parked) return route.fulfill({ status: 502, headers: { [`${META}error`]: "unknown request" }, body: "" });
    const d = parked.descriptor;
    const method = (d.method || "GET").toUpperCase();
    const headers = new Map();
    let hasAccept = false;
    let hasLang = false;
    let hasUa = false;
    for (const [name, value] of d.headers || []) {
      const lower = name.toLowerCase();
      if (TUNNEL_SKIP.has(lower)) continue;
      if (lower === "accept") hasAccept = true;
      if (lower === "accept-language") hasLang = true;
      if (lower === "user-agent") hasUa = true;
      headers.set(lower, value);
    }
    if (!hasUa) headers.set("user-agent", this.userAgent);
    if (!hasAccept) headers.set("accept", "*/*");
    if (!hasLang) headers.set("accept-language", this.acceptLanguage);
    if (d.mode === "cors" || !(method === "GET" || method === "HEAD")) headers.set("origin", "file://");

    if (this.apiMock) {
      const mocked = await this.apiMock(d, parked.body);
      if (mocked) {
        return route.fulfill({
          status: mocked.status ?? 200,
          headers: { "content-type": "application/json", date: new Date().toUTCString(), [`${META}status`]: String(mocked.status ?? 200), [`${META}url`]: d.url, [`${META}redirected`]: "0", [`${META}content-type`]: "application/json" },
          body: JSON.stringify(mocked.json ?? {}),
        });
      }
    }

    let result;
    try {
      result = await execute({ url: d.url, method, headers, body: parked.body && method !== "GET" && method !== "HEAD" ? parked.body : undefined, redirect: d.redirect || "follow" });
    } catch (error) {
      stats.errors.push(`tunnel ${method} ${d.url}: ${error.cause?.code || error.message}`);
      return route.fulfill({ status: 502, headers: { [`${META}error`]: String(error.message).slice(0, 200), "cache-control": "no-store" }, body: "" });
    }
    const { res } = result;
    const out = copyHeaders(res, false);
    const rawType = res.headers.get("content-type");
    out[`${META}status`] = String(res.status);
    out[`${META}status-text`] = encodeURIComponent(res.statusText || "");
    out[`${META}url`] = result.url;
    out[`${META}redirected`] = result.redirected ? "1" : "0";
    if (rawType) {
      out[`${META}content-type`] = rawType;
      out["content-type"] = rawType;
    }
    const body = Buffer.from(await res.arrayBuffer());
    return route.fulfill({ status: allowedWebStatus(res.status) ? res.status : 200, headers: out, body });
  }

  // NetProxy.handleSubresource
  async subresource(route) {
    const request = route.request();
    const method = request.method().toUpperCase();
    const incoming = request.headers();
    const requestOrigin = incoming.origin;
    const cors = {};
    if (requestOrigin && requestOrigin !== "null") {
      cors["access-control-allow-origin"] = requestOrigin;
      cors["access-control-allow-credentials"] = "true";
    } else {
      cors["access-control-allow-origin"] = "*";
    }
    cors["access-control-allow-headers"] = "*";
    cors["access-control-allow-methods"] = "GET, HEAD, OPTIONS";
    cors["access-control-expose-headers"] = "*";
    if (method === "OPTIONS") {
      stats.preflight += 1;
      return route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-headers": incoming["access-control-request-headers"] || "*", "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" }, body: "" });
    }
    if (method !== "GET" && method !== "HEAD") return route.continue();
    stats.subresource += 1;
    const headers = new Map();
    let hasUa = false;
    let hasLang = false;
    for (const [name, value] of Object.entries(incoming)) {
      const lower = name.toLowerCase();
      if (SUB_SKIP.has(lower)) continue;
      if (lower === "user-agent") hasUa = true;
      if (lower === "accept-language") hasLang = true;
      headers.set(lower, value);
    }
    if (!hasUa) headers.set("user-agent", this.userAgent);
    if (!hasLang) headers.set("accept-language", this.acceptLanguage);
    if (requestOrigin) headers.set("origin", "file://");
    let result;
    try {
      result = await execute({ url: request.url(), method, headers, redirect: "follow" });
    } catch (error) {
      stats.errors.push(`sub ${request.url()}: ${error.cause?.code || error.message}`);
      return route.fulfill({ status: 502, headers: cors, body: "" });
    }
    const { res } = result;
    const out = { ...copyHeaders(res, true), ...cors };
    const rawType = res.headers.get("content-type");
    if (rawType) out["content-type"] = rawType;
    const body = Buffer.from(await res.arrayBuffer());
    if (!allowedWebStatus(res.status)) return route.fulfill({ status: 502, headers: out, body: "" });
    return route.fulfill({ status: res.status, headers: out, body });
  }
}

// init script: what the android WebView exposes through addJavascriptInterface
export function bridgeInitScript(info) {
  return `
    (() => {
      const info = ${JSON.stringify(JSON.stringify(info))};
      window.LinerNet = {
        prepare(id, descriptor, body) {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/__harness_prepare__", false);
          xhr.send(JSON.stringify({ id, descriptor, body }));
        },
        cancel(id) { window.__harnessSend && window.__harnessSend("net:cancel", JSON.stringify([id])); },
      };
      window.LinerAndroid = {
        getInfo() { return info; },
        invoke(callId, channel, args) { window.__harnessInvoke(callId, channel, args); },
        send(channel, args) { window.__harnessSend(channel, args); },
      };
    })();
  `;
}
