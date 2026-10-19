// Desktop test harness for the android WebView side. Runs the real renderer +
// cloudmusic-android.js in headless chromium with phone emulation while
// native-sim.mjs plays the role of the java layer (tunnel, subresource proxy,
// ipc). Usage: node harness.mjs <scenario> [...]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { APP_ORIGIN, NativeSim, bridgeInitScript, stats } from "./native-sim.mjs";

const require = createRequire("/home/user/.cache/pw/");
const { chromium } = require("playwright");

const WWW = process.env.HARNESS_WWW || "/home/user/.cache/harness-www";
const OUT = process.env.HARNESS_OUT || "/home/user/.cache/harness-out";
fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const scenario = process.argv[2] || "ui";
const log = (...args) => console.log(`[harness:${scenario}]`, ...args);

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage"],
});

// ---------------------------------------------------------------- PO tokens
// PoTokenService.java equivalent: hidden page on https://www.youtube.com/robots.txt
let poPage = null;
let poReady = null;
const poPending = new Map();
let poSeq = 1;
async function ensurePoPage() {
  if (poReady) return poReady;
  poReady = (async () => {
    const ctx = await browser.newContext({ userAgent: UA, locale: "en-US" });
    poPage = await ctx.newPage();
    let markReady;
    const ready = new Promise((resolve) => (markReady = resolve));
    await poPage.exposeBinding("__poReady", () => markReady());
    await poPage.exposeBinding("__poResult", (_src, json) => {
      const result = JSON.parse(json);
      const entry = poPending.get(result.id);
      if (!entry) return;
      poPending.delete(result.id);
      if (result.token) entry.resolve(result.token);
      else entry.reject(new Error(result.error || "PO token minting failed"));
    });
    await poPage.exposeBinding("__poInterpreter", async (_src, id, url) => {
      let text = null;
      let error = null;
      try {
        const target = new URL(url);
        if (target.protocol !== "https:" || !["www.google.com", "www.gstatic.com"].includes(target.hostname)) throw new Error("interpreter host not allowed");
        const res = await fetch(target, { headers: { "user-agent": UA } });
        if (!res.ok) throw new Error(`interpreter download failed with ${res.status}`);
        text = await res.text();
      } catch (e) {
        error = String(e.message || e);
      }
      await poPage.evaluate(([i, t, e]) => window.__cloudMusicPoWorker.interpreterResult(i, t, e), [id, text, error]);
    });
    await poPage.addInitScript(() => {
      window.CloudMusicPoBridge = {
        ready: () => window.__poReady(),
        result: (json) => window.__poResult(json),
        interpreter: (id, url) => window.__poInterpreter(id, url),
      };
    });
    await poPage.goto("https://www.youtube.com/robots.txt");
    await poPage.evaluate(fs.readFileSync(path.join(WWW, "potoken-worker.js"), "utf8"));
    await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error("PO token window did not start")), 20000))]);
  })();
  return poReady;
}
async function mintPoToken(identifier) {
  if (!/^[\w-]{1,128}$/.test(identifier)) throw new Error("invalid identifier");
  await ensurePoPage();
  const id = poSeq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      poPending.delete(id);
      reject(new Error("PO token minting timed out"));
    }, 20000);
    poPending.set(id, {
      resolve: (t) => (clearTimeout(timer), resolve(t)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    poPage.evaluate(([i, ident]) => window.__cloudMusicPoWorker.mint(i, ident), [id, identifier]);
  });
}

// ------------------------------------------------------------ app context
const events = [];
async function newAppContext({ width, height, dpr = 2.625, uiScale = 1, phone = true, apiMock = null, colorScheme = "dark" }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    locale: "de-DE",
    colorScheme,
  });
  const sim = new NativeSim({ wwwDir: WWW, userAgent: UA, apiMock });
  await context.route("**/*", (route) => sim.route(route));
  await context.addInitScript(bridgeInitScript({
    platform: "android", role: "main", appVersion: "0.1.40", sdkInt: 35, phone,
    viewport: { wDp: width, hDp: height }, uiScale, model: "Harness Pixel",
  }));
  await context.exposeBinding("__harnessInvoke", async ({ page }, callId, channel, argsJson) => {
    const args = JSON.parse(argsJson || "[]");
    let ok = true;
    let value = null;
    try {
      switch (channel) {
        case "potoken:mint":
          value = await mintPoToken(args[0]);
          events.push(`potoken:mint ok (${value.length} chars)`);
          break;
        case "window:is-maximized":
        case "window:is-fullscreen":
          value = false;
          break;
        case "storage:get-cache-stats":
          value = { cacheSize: 0, httpCacheSize: 0, codeCacheSize: 0, serviceWorkerSize: 0, indexedDbSize: 0, localStorageSize: 0, blobStorageSize: 0, cachePath: "/data/user/0/com.hkamori.cloudmusic/cache" };
          break;
        case "overlay:get-initial-state":
          value = null;
          break;
        default:
          events.push(`invoke ${channel} ${argsJson.slice(0, 120)}`);
          value = null;
      }
    } catch (error) {
      ok = false;
      value = { message: String(error.message || error) };
      events.push(`invoke ${channel} FAILED: ${value.message}`);
    }
    await page.evaluate(([id, okFlag, json]) => window.__cloudMusicIpc && window.__cloudMusicIpc.reply(id, okFlag, json), [callId, ok, JSON.stringify(value)]).catch(() => undefined);
  });
  await context.exposeBinding("__harnessSend", (_src, channel, argsJson) => {
    if (channel === "touchbar:update-state") {
      const state = JSON.parse(argsJson)[0];
      events.push(`media ${state.status} ${state.track?.title ?? "-"} @${state.positionMs}`);
    } else if (channel !== "net:cancel") {
      events.push(`send ${channel} ${String(argsJson).slice(0, 120)}`);
    }
  });
  return context;
}

function attachConsole(page, sink) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" || msg.type() === "warning") sink.push(`[${msg.type()}] ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (err) => sink.push(`[pageerror] ${String(err).slice(0, 300)}`));
}

function summary(extra = {}) {
  return {
    tunnel: stats.tunnel,
    subresource: stats.subresource,
    preflight: stats.preflight,
    rewrittenHops: stats.rewritten,
    errors: stats.errors.slice(0, 15),
    hosts: Object.fromEntries([...stats.hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)),
    events: events.slice(0, 40),
    ...extra,
  };
}

// --------------------------------------------------------------- scenarios
try {
  if (scenario === "ui") {
    // login page at phone-landscape size + a login attempt with bogus credentials:
    // exercises tunnel, request signer (wasm), clock sync via the `date` header
    const [w, h] = (process.argv[3] || "915x412").split("x").map(Number);
    const context = await newAppContext({ width: w, height: h });
    const page = await context.newPage();
    const consoleLines = [];
    attachConsole(page, consoleLines);
    await page.goto(`${APP_ORIGIN}/index.html`);
    await page.waitForSelector('input[type="email"]', { timeout: 30000 });
    await page.waitForTimeout(2500);
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
      scale: window.visualViewport?.scale,
      hasBridge: typeof window.cloudMusicElectron === "object",
      platform: window.cloudMusicElectron?.platform,
      envWarning: document.body.innerText.includes("Electron") || document.body.innerText.includes("Desktop-App"),
    }));
    await page.screenshot({ path: `${OUT}/login-${w}x${h}.png` });
    await page.fill('input[type="email"]', "android-harness-test@example.com");
    await page.fill('input[type="password"]', "definitely-wrong-password-123");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(6000);
    const errorText = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("p, span, div")).filter((n) => n.children.length === 0 && /fehl|ungültig|falsch|invalid|incorrect|error/i.test(n.textContent || ""));
      return nodes.map((n) => n.textContent.trim()).slice(0, 5);
    });
    await page.screenshot({ path: `${OUT}/login-error-${w}x${h}.png` });
    console.log(JSON.stringify(summary({ metrics, errorText, console: consoleLines.slice(0, 20) }), null, 2));
  } else if (scenario === "playback") {
    // resolves real youtube / soundcloud audio through the tunnel and plays it in an
    // <audio crossorigin> element routed through the subresource proxy + web audio
    const videoId = process.argv[3] || "dQw4w9WgXcQ";
    const mode = process.argv[4] || "auto";
    const context = await newAppContext({ width: 915, height: 412 });
    const page = await context.newPage();
    const consoleLines = [];
    attachConsole(page, consoleLines);
    await page.goto(`${APP_ORIGIN}/test.html`);
    const result = await page.evaluate(async ([id, m]) => {
      const t = window.__test;
      const out = {};
      const started = performance.now();
      try {
        out.visitorData = (await t.getClientVisitorData()).slice(0, 12);
      } catch (e) {
        out.visitorError = String(e);
      }
      let stream;
      try {
        stream = m === "apps"
          ? await t.resolveDirectAudioStream(id, { profiles: t.PLAYBACK_PROFILES })
          : await t.resolveDirectAudioStream(id);
        out.stream = { mimeType: stream.mimeType, codec: stream.codec, bitrate: stream.bitrate, contentLength: stream.contentLength, host: new URL(stream.url).hostname, hasPot: new URL(stream.url).searchParams.has("pot") };
      } catch (e) {
        out.resolveError = String(e.message || e);
        return out;
      }
      out.resolveMs = Math.round(performance.now() - started);
      // chunked download through the tunnel (background cache path)
      try {
        const bytes = await t.downloadAudioBytes(stream.url, { contentLength: Math.min(stream.contentLength || 0, 3 * 1024 * 1024) || undefined });
        out.downloadedBytes = bytes ? bytes.byteLength : 0;
      } catch (e) {
        out.downloadError = String(e.message || e);
      }
      // direct playback: <audio crossorigin="anonymous"> + MediaElementSource (needs CORS-clean media)
      const audio = document.getElementById("cloudmusic-audio");
      audio.src = stream.url;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("canplay timeout")), 25000);
          audio.addEventListener("canplay", () => (clearTimeout(timer), resolve()), { once: true });
          audio.addEventListener("error", () => (clearTimeout(timer), reject(new Error("media error " + audio.error?.code + " " + audio.error?.message))), { once: true });
        });
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        source.connect(analyser);
        analyser.connect(ctx.destination);
        audio.currentTime = 30;
        await audio.play();
        await new Promise((r) => setTimeout(r, 3500));
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        out.playback = { duration: Math.round(audio.duration), currentTime: Math.round(audio.currentTime * 10) / 10, paused: audio.paused, peak: Math.round(peak * 1000) / 1000 };
      } catch (e) {
        out.playbackError = String(e.message || e);
      }
      return out;
    }, [videoId, mode]);
    console.log(JSON.stringify(summary({ result, console: consoleLines.slice(0, 20) }), null, 2));
  } else if (scenario === "soundcloud") {
    const query = process.argv[3] || "https://soundcloud.com/forss/flickermood";
    const context = await newAppContext({ width: 915, height: 412 });
    const page = await context.newPage();
    const consoleLines = [];
    attachConsole(page, consoleLines);
    await page.goto(`${APP_ORIGIN}/test.html`);
    const result = await page.evaluate(async (q) => {
      const t = window.__test;
      const out = {};
      try {
        // resolve a public soundcloud track page url like the importer does, then stream it
        const res = await fetch(q, { redirect: "follow" });
        out.pageStatus = res.status;
        out.finalUrl = res.url;
        const html = await res.text();
        const id = /soundcloud:\/\/sounds:(\d+)/.exec(html)?.[1];
        out.trackId = id;
        if (id) {
          const s = await t.resolveSoundCloudStream(`sc:${id}`);
          out.stream = { mimeType: s.mimeType, codec: s.codec, blob: Boolean(s.blob), bytes: s.blob?.size ?? s.contentLength, url: s.url ? new URL(s.url).hostname : null };
        }
      } catch (e) {
        out.error = String(e.message || e);
      }
      return out;
    }, query);
    console.log(JSON.stringify(summary({ result, console: consoleLines.slice(0, 20) }), null, 2));
  } else if (scenario === "layout") {
    // main app shell with a fake session; api answers are mocked so the layout renders
    const [w, h] = (process.argv[3] || "915x412").split("x").map(Number);
    const uiScale = Number(process.argv[4] || 1);
    const route = process.argv[5] || "#/";
    const apiMock = async (d) => {
      const url = new URL(d.url);
      if (url.hostname !== "api.tryliner.fun") return null;
      if (url.pathname.includes("/auth/")) return { json: {} };
      if (url.pathname.endsWith("/me") || url.pathname.includes("/profile")) return { json: { id: "u1", username: "android", displayName: "Android", email: "a@b.c" } };
      return { json: { items: [], tracks: [], playlists: [], data: [], results: [], sections: [], mixes: [] } };
    };
    const context = await newAppContext({ width: w, height: h, uiScale, apiMock });
    await context.addInitScript(() => {
      const payload = btoa(JSON.stringify({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 86400 })).replace(/=+$/, "");
      const token = `x.${payload}.y`;
      localStorage.setItem("cloudmusic_auth_session", JSON.stringify({ accessToken: token, refreshToken: "r", expiresAt: Date.now() + 86400000, user: { id: "u1", username: "android", displayName: "Android", email: "a@b.c" } }));
    });
    const page = await context.newPage();
    const consoleLines = [];
    attachConsole(page, consoleLines);
    await page.goto(`${APP_ORIGIN}/index.html${route}`);
    await page.waitForTimeout(7000);
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }));
    const name = `layout-${w}x${h}-s${uiScale}-${route.replace(/[^a-z]/gi, "") || "home"}`;
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(JSON.stringify(summary({ metrics, screenshot: `${OUT}/${name}.png`, console: consoleLines.slice(0, 12) }), null, 2));
  } else if (scenario === "player") {
    // end-to-end through the real UI: a restored session track, press play in the
    // mini player, the renderer resolves youtube audio itself and plays it, the
    // media session (touchbar channel) must report "playing"
    const [w, h] = (process.argv[3] || "915x412").split("x").map(Number);
    const uiScale = Number(process.argv[4] || 1);
    const apiMock = async (d) => {
      const url = new URL(d.url);
      if (url.hostname !== "api.tryliner.fun") return null;
      return { json: { items: [], tracks: [], playlists: [], data: [], results: [], sections: [], mixes: [] } };
    };
    const context = await newAppContext({ width: w, height: h, uiScale, apiMock });
    await context.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const payload = btoa(JSON.stringify({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 86400 })).replace(/=+$/, "");
      localStorage.setItem("cloudmusic_auth_session", JSON.stringify({ accessToken: `x.${payload}.y`, refreshToken: "r", expiresAt: Date.now() + 86400000, user: { id: "u1", username: "android", displayName: "Android", email: "a@b.c" } }));
      const track = { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artists: "Rick Astley", coverUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", durationMs: 213000, playCount: 0 };
      localStorage.setItem("cloudmusic_player_session_v2", JSON.stringify({ state: { queue: [track], currentIndex: 0, currentTrack: track, playbackContext: null, playbackContextCover: null, positionMs: 0, durationMs: 213000, volume: 0.6, repeat: "off", shuffle: false, defaultPlaybackContext: "resume" }, version: 0 }));
    });
    const page = await context.newPage();
    const consoleLines = [];
    attachConsole(page, consoleLines);
    await page.goto(`${APP_ORIGIN}/index.html#/`);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/player-mini-${w}x${h}-s${uiScale}.png` });
    // the mini player's play button: the round button in the player bar
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const candidates = buttons.filter((b) => /play|abspielen|wiedergabe/i.test(b.getAttribute("aria-label") || "") || b.querySelector("svg"));
      const bar = buttons.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.top > window.innerHeight - 90 && r.width >= 28 && r.width <= 48 && Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 120;
      });
      const target = bar.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || candidates[0];
      if (!target) return null;
      target.click();
      return target.outerHTML.slice(0, 160);
    });
    await page.waitForTimeout(15000);
    const audio = await page.evaluate(() => {
      const a = document.getElementById("cloudmusic-audio");
      return a ? { paused: a.paused, currentTime: Math.round(a.currentTime * 10) / 10, duration: Math.round(a.duration || 0), src: (a.currentSrc || "").slice(0, 60), error: a.error?.code ?? null } : null;
    });
    await page.screenshot({ path: `${OUT}/player-playing-${w}x${h}-s${uiScale}.png` });
    await page.evaluate(() => { location.hash = "#/player"; });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/player-full-${w}x${h}-s${uiScale}.png` });
    console.log(JSON.stringify(summary({ clicked, audio, console: consoleLines.slice(0, 15) }), null, 2));
  } else if (scenario === "fetch") {
    // fetch() semantics of the tunnel that the renderer relies on
    const context = await newAppContext({ width: 915, height: 412 });
    const page = await context.newPage();
    const consoleLines = [];
    attachConsole(page, consoleLines);
    await page.goto(`${APP_ORIGIN}/test.html`);
    const result = await page.evaluate(async () => {
      const out = {};
      const run = async (name, fn) => {
        try {
          out[name] = await fn();
        } catch (e) {
          out[name] = `THROWS ${e?.name}: ${e?.message}`;
        }
      };
      await run("redirect", async () => {
        const r = await fetch("https://youtu.be/dQw4w9WgXcQ", { redirect: "follow" });
        await r.body?.cancel();
        return { status: r.status, url: r.url, redirected: r.redirected, type: r.type };
      });
      await run("headersReadable", async () => {
        const r = await fetch("https://api.tryliner.fun/health");
        return { date: Boolean(r.headers.get("date")), ct: r.headers.get("content-type"), xInstance: r.headers.get("x-liner-instance"), meta: [...r.headers.keys()].filter((k) => k.startsWith("x-cmproxy")).length, body: await r.json() };
      });
      await run("clone", async () => {
        const r = await fetch("https://api.tryliner.fun/health");
        const c = r.clone();
        return { cloneUrl: c.url, a: (await r.text()).length > 0, b: (await c.text()).length > 0 };
      });
      await run("head", async () => {
        const r = await fetch("https://api.tryliner.fun/health", { method: "HEAD" });
        return { status: r.status, body: r.body === null };
      });
      await run("status404", async () => {
        const r = await fetch("https://api.tryliner.fun/definitely-missing-route");
        return { status: r.status, ok: r.ok, statusText: r.statusText };
      });
      await run("dnsFailure", async () => {
        await fetch("https://no-such-host.invalid/");
        return "resolved?!";
      });
      await run("abort", async () => {
        const controller = new AbortController();
        const p = fetch("https://httpbin.org/delay/5", { signal: controller.signal });
        setTimeout(() => controller.abort(), 300);
        await p;
        return "not aborted?!";
      });
      await run("preAborted", async () => {
        await fetch("https://api.tryliner.fun/health", { signal: AbortSignal.abort() });
        return "not aborted?!";
      });
      await run("postEcho", async () => {
        const r = await fetch("https://httpbin.org/anything", { method: "POST", headers: { "content-type": "application/json", "x-test": "1", "x-cloudmusic-user-agent": "kept-for-other-hosts" }, body: JSON.stringify({ a: "ü€" }) });
        const j = await r.json();
        return { method: j.method, json: j.json, origin: j.headers.Origin, ua: j.headers["User-Agent"]?.slice(0, 40), xTest: j.headers["X-Test"], cloudMusicUa: j.headers["X-Cloudmusic-User-Agent"], lang: j.headers["Accept-Language"] };
      });
      await run("formData", async () => {
        const fd = new FormData();
        fd.append("field", "value");
        fd.append("file", new Blob([new Uint8Array([1, 2, 3, 250])], { type: "application/octet-stream" }), "x.bin");
        const r = await fetch("https://httpbin.org/post", { method: "POST", body: fd });
        const j = await r.json();
        return { form: j.form, file: j.files?.file?.length, ct: j.headers["Content-Type"]?.slice(0, 30) };
      });
      await run("requestObject", async () => {
        const req = new Request("https://httpbin.org/anything?x=1", { method: "PUT", body: "plain-text" });
        const j = await (await fetch(req)).json();
        return { method: j.method, data: j.data, args: j.args };
      });
      await run("youtubeRewrite", async () => {
        const r = await fetch("https://www.youtube.com/sw.js_data");
        return { status: r.status, len: (await r.text()).length };
      });
      return out;
    });
    console.log(JSON.stringify(summary({ result, console: consoleLines.slice(0, 10) }), null, 2));
  } else if (scenario === "potoken") {
    const token = await mintPoToken(process.argv[3] || "dQw4w9WgXcQ");
    console.log(JSON.stringify({ ok: true, length: token.length, sample: token.slice(0, 16) }));
  }
} catch (error) {
  console.error("HARNESS FAILURE", error);
  console.log(JSON.stringify(summary(), null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
