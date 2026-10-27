// Verifies the actual playback mirroring: the host starts a song in the UI and
// the listener has to follow (same track, similar position) without touching
// anything. Also exercises the skip vote.
//
//   node server/lobby/index.mjs &
//   node scripts/lobby-sync-e2e.mjs
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:5201/";
const LOBBY_URL = process.env.LOBBY_URL || "ws://127.0.0.1:4300/v1/lobby/ws";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
};
const json = (body, status = 200) => ({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

const TITLES = ["Midnight Drive", "Paper Planes", "Golden Hour", "Slow Rivers", "Neon Garden", "Static Bloom"];
const TRACKS = TITLES.map((title, i) => ({
  id: `demoTrack${i + 1}`,
  title,
  artists: [{ id: `artist${i}`, name: ["Nova Kane", "The Loops", "Mira Sol", "Hollow Coast", "June Atlas", "Pale Waves"][i] }],
  durationMs: 200000,
  cover: { url: "", width: 480, height: 480 },
}));

async function newPage(browser, userId, displayName, size = { width: 1280, height: 820 }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...size, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("127.0.0.1:5201") || url.startsWith("data:") || url.startsWith("blob:")) return req.continue();
    if (url.includes("api.tryliner.fun")) {
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS, body: "" });
      const path = url.split("api.tryliner.fun")[1].split("?")[0];
      if (path === "/v1/me") return req.respond(json({ id: userId, email: `${userId}@d.l`, username: userId, displayName, avatarUrl: null }));
      if (path.startsWith("/v1/search")) return req.respond(json({ items: TRACKS, results: TRACKS }));
      if (path.startsWith("/v1/explore/popular")) return req.respond(json({ items: TRACKS }));
      if (path.startsWith("/v1/me/history")) return req.respond(json({ items: TRACKS.slice(0, 3) }));
      if (path.includes("/lyrics")) return req.respond({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body: "\n" });
      return req.respond(json({ items: [], nextCursor: null }));
    }
    return req.abort();
  });
  await page.evaluateOnNewDocument(
    ({ lobbyUrl, userId, displayName }) => {
    const user = { id: userId, email: `${userId}@d.l`, username: userId, displayName, avatarUrl: null };
    localStorage.setItem("cloudmusic_auth_session", JSON.stringify({ accessToken: "demo", refreshToken: "demo", user }));
    localStorage.setItem("cloudmusic_locale", "de");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("cloudmusic_lobby_url", lobbyUrl);
    const track = (i) => ({
      id: `demoTrack${i}`,
      title: ["Midnight Drive", "Paper Planes", "Golden Hour"][i - 1] || `Track ${i}`,
      artists: ["Nova Kane", "The Loops", "Mira Sol"][i - 1] || "Artist",
      coverUrl: "",
      durationMs: 200000,
      playCount: 0,
    });
    localStorage.setItem(
      "cloudmusic_player_session_v2",
      JSON.stringify({
        state: {
          queue: [1, 2, 3].map(track),
          currentIndex: 0,
          currentTrack: track(1),
          positionMs: 0,
          durationMs: 200000,
          repeat: "off",
          shuffle: false,
          volume: 1,
          audioQuality: "high",
          miniPlayerStyle: "default",
          accentVariant: "default",
          pauseOnDeviceChange: true,
          autoplaySimilar: true,
          trackDoubleClickBehavior: "play",
          defaultPlaybackContext: "resume",
          playbackRate: 1,
          pitchSemitones: 0,
          isPitchLinked: true,
          eqEnabled: false,
          eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
        version: 0,
      }),
    );
    sessionStorage.setItem("cloudmusic:env-warning-skipped", "1");
    },
    { lobbyUrl: LOBBY_URL, userId, displayName },
  );
  page.on("console", (m) => {
    const text = m.text();
    if (text.includes("lobby") || text.includes("Lobby") || m.type() === "error") console.log(`[${userId}/${m.type()}]`, text.slice(0, 220));
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3000));
  return page;
}

const click = (page, selectorOrText) =>
  page.evaluate((target) => {
    let node = null;
    try {
      node = document.querySelector(target);
    } catch {
      node = null;
    }
    if (!node) {
      node = [...document.querySelectorAll("button, a, [role='tab']")].find((el) => (el.textContent || "").trim().includes(target));
    }
    if (!node) return false;
    node.click();
    return true;
  }, selectorOrText);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  protocolTimeout: 120_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
const errors = [];

// ── host: create lobby, start a song ─────────────────────────────────────
const host = await newPage(browser, "fufi", "Fufi");
host.on("pageerror", (e) => errors.push(`host: ${String(e).slice(0, 200)}`));
await click(host, 'button[aria-label="Einstellungen"]');
await new Promise((r) => setTimeout(r, 1200));
await click(host, "Lobby");
await new Promise((r) => setTimeout(r, 700));
await click(host, "Lobby erstellen");
await new Promise((r) => setTimeout(r, 2200));
const code = await host.evaluate(() => (document.body.innerText.match(/\b([1-9]\d{3})\b/) || [])[1]);
console.log("code:", code);

// ── listener: join and get approved ──────────────────────────────────────
const guest = await newPage(browser, "mira", "Mira");
guest.on("pageerror", (e) => errors.push(`guest: ${String(e).slice(0, 200)}`));
await click(guest, 'button[aria-label="Einstellungen"]');
await new Promise((r) => setTimeout(r, 1200));
await click(guest, "Lobby");
await new Promise((r) => setTimeout(r, 700));
await guest.click('input[aria-label="Lobby code"]');
await guest.keyboard.type(code, { delay: 30 });
await new Promise((r) => setTimeout(r, 300));
await click(guest, "Beitritt anfragen");
await new Promise((r) => setTimeout(r, 2200));
await click(host, "Erlauben");
await new Promise((r) => setTimeout(r, 2500));
console.log("guest in lobby:", await guest.evaluate(() => document.body.innerText.toLowerCase().includes("du hörst bei")));

// ── host starts "Golden Hour" from the home page ─────────────────────────
const closed = await host.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Schließen"]');
  if (!btn) return false;
  btn.click();
  return true;
});
await new Promise((r) => setTimeout(r, 1500));
console.log("settings closed:", closed, "| main text:", await host.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\n/g, " | ").slice(0, 160)));
// press play in the host's player – the seeded queue starts with "Midnight Drive"
const started = await host.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Play"]');
  if (!btn) return false;
  btn.click();
  return true;
});
console.log("host pressed play:", started);

await new Promise((r) => setTimeout(r, 5000));

const guestTrack = () =>
  guest.evaluate(() => {
    const text = document.body.innerText;
    return ["Midnight Drive", "Paper Planes", "Golden Hour"].find((title) => text.includes(title)) || null;
  });
console.log("guest before host skip:", await guestTrack());

// the host skips once – the listener must switch along
await host.evaluate(() => document.querySelector('button[aria-label="Next track"]')?.click());
await new Promise((r) => setTimeout(r, 5000));
console.log("guest after host skip:", await guestTrack());

// ── vote: the listener asks to skip ──────────────────────────────────────
await click(guest, 'button[aria-label="Einstellungen"]');
await new Promise((r) => setTimeout(r, 1000));
await click(guest, "Lobby");
await new Promise((r) => setTimeout(r, 700));
await click(guest, "Song überspringen");
await new Promise((r) => setTimeout(r, 6000));
console.log("guest after voting to skip:", await guestTrack());

if (errors.length) console.log("PAGE ERRORS:", errors.join("\n"));
await browser.close();
