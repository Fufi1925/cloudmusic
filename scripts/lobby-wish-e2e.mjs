// End-to-end check for song wishes + the host's right-hand pop-up (0.1.52).
//
//   node server/lobby/index.mjs &
//   node scripts/lobby-wish-e2e.mjs [outdir]
//
// host creates a lobby → listener joins → listener searches a song and wishes it
// → host accepts it in the pop-up → the song lands in the host's queue.
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:5201/";
const LOBBY_URL = process.env.LOBBY_URL || "ws://127.0.0.1:4300/v1/lobby/ws";
const OUT = process.argv[2] || "/home/user/shots";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
  date: new Date().toUTCString(),
};
const json = (body, status = 200) => ({
  status,
  contentType: "application/json",
  headers: CORS,
  body: JSON.stringify(body),
});

const TRACKS = Array.from({ length: 8 }, (_, i) => ({
  type: "track",
  id: `demoTrack${i + 1}`,
  title: ["Midnight Drive", "Paper Planes", "Golden Hour", "Slow Rivers", "Neon Garden", "Static Bloom", "Velvet Noise", "Afterglow"][i],
  artists: [{ id: `artist${i}`, name: ["Nova Kane", "The Loops", "Mira Sol", "Hollow Coast", "June Atlas", "Pale Waves", "Echo Park", "Sable"][i] }],
  durationMs: 180000 + i * 12000,
  cover: { url: "", width: 480, height: 480 },
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function preparePage(browser, { userId, displayName, width = 1280, height = 860 }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("127.0.0.1:5201") || url.startsWith("data:") || url.startsWith("blob:")) return req.continue();
    if (url.includes("api.tryliner.fun")) {
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS, body: "" });
      const path = url.split("api.tryliner.fun")[1].split("?")[0];
      if (path === "/v1/me") {
        return req.respond(json({ id: userId, email: `${userId}@demo.local`, username: userId, displayName, avatarUrl: null }));
      }
      if (path.startsWith("/v1/search")) return req.respond(json({ items: TRACKS, results: TRACKS }));
      if (path.startsWith("/v1/explore/popular")) return req.respond(json({ items: TRACKS }));
      if (path.startsWith("/v1/me/history")) return req.respond(json({ items: TRACKS.slice(0, 5) }));
      if (path.includes("/lyrics")) return req.respond({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body: "\n" });
      if (path.includes("/radio")) return req.respond(json({ items: TRACKS }));
      return req.respond(json({ items: [], nextCursor: null }));
    }
    return req.abort();
  });

  await page.evaluateOnNewDocument(
    ({ userId, displayName, lobbyUrl }) => {
      const user = { id: userId, email: `${userId}@demo.local`, username: userId, displayName, avatarUrl: null };
      localStorage.setItem("cloudmusic_auth_session", JSON.stringify({ accessToken: "demo_token", refreshToken: "demo_refresh", user }));
      localStorage.setItem("cloudmusic_locale", "de");
      localStorage.setItem("theme", "dark");
      localStorage.setItem("cloudmusic_lobby_url", lobbyUrl);
      const track = (i) => ({
        id: `demoTrack${i}`,
        title: ["Midnight Drive", "Paper Planes", "Golden Hour", "Slow Rivers"][i - 1] || `Track ${i}`,
        artists: ["Nova Kane", "The Loops", "Mira Sol", "Hollow Coast"][i - 1] || "Artist",
        coverUrl: "",
        durationMs: 194000,
        playCount: 0,
      });
      localStorage.setItem(
        "cloudmusic_player_session_v2",
        JSON.stringify({
          state: {
            queue: [1, 2, 3, 4].map(track),
            currentIndex: 0,
            currentTrack: track(1),
            positionMs: 42000,
            durationMs: 194000,
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
    { userId, displayName, lobbyUrl: LOBBY_URL },
  );

  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(3500);
  return page;
}

async function clickText(page, text) {
  const ok = await page.evaluate((label) => {
    let direct = null;
    try {
      direct = document.querySelector(label);
    } catch {
      direct = null;
    }
    if (direct) {
      direct.click();
      return true;
    }
    const nodes = [...document.querySelectorAll("button, a, [role='tab'], [role='button']")];
    const hit = nodes.find((node) => (node.textContent || "").trim().includes(label));
    if (!hit) return false;
    hit.click();
    return true;
  }, text);
  if (!ok) console.log("CLICK MISS:", text);
  return ok;
}

async function openLobbyTab(page) {
  await clickText(page, 'button[aria-label="Einstellungen"]');
  await sleep(1200);
  await clickText(page, "Lobby");
  await sleep(800);
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  protocolTimeout: 120_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"],
});

const errors = [];
const checks = {};

const host = await preparePage(browser, { userId: "fufi", displayName: "Fufi" });
host.on("pageerror", (error) => errors.push(`host: ${String(error).slice(0, 200)}`));
await openLobbyTab(host);
await clickText(host, "Lobby erstellen");
await sleep(2500);
const code = await host.evaluate(() => {
  const match = document.body.innerText.match(/\b([1-9]\d{3})\b/);
  return match ? match[1] : null;
});
console.log("host code:", code);
checks.code = Boolean(code);

const guest = await preparePage(browser, { userId: "mira", displayName: "Mira" });
guest.on("pageerror", (error) => errors.push(`guest: ${String(error).slice(0, 200)}`));
await openLobbyTab(guest);
await guest.click('input[aria-label="Lobby code"]');
await guest.keyboard.type(code, { delay: 35 });
await sleep(400);
await clickText(guest, "Beitritt anfragen");
await sleep(2500);
await clickText(host, "Erlauben");
await sleep(2500);

checks.guestJoined = await guest.evaluate(() => document.body.innerText.includes("Du folgst der Wiedergabe"));

// ── the listener searches a song and wishes it ──────────────────────────
const searchInput = await guest.$('input[placeholder="Song suchen …"]');
checks.searchField = Boolean(searchInput);
if (searchInput) {
  await searchInput.click();
  await guest.keyboard.type("Paper", { delay: 40 });
  await sleep(1800);
}
await guest.screenshot({ path: `${OUT}/0.1.52-wish-search.png` });

checks.searchResults = await guest.evaluate(() => document.body.innerText.includes("Paper Planes"));
const wished = await guest.evaluate(() => {
  const rows = [...document.querySelectorAll("div")];
  const row = rows.find((node) => {
    const text = (node.innerText || "").trim();
    return text.startsWith("Paper Planes") && text.includes("Wünschen") && node.querySelectorAll("button").length === 1;
  });
  if (!row) return false;
  row.querySelector("button")?.click();
  return true;
});
if (!wished) console.log("CLICK MISS: wish row");
await sleep(1500);

checks.wishListed = await guest.evaluate(
  () => document.body.innerText.includes("Song-Wünsche") || document.body.innerText.includes("Song-Wunsch"),
);
await guest.screenshot({ path: `${OUT}/0.1.52-wish-listener.png` });

// ── the host gets the right-hand pop-up ─────────────────────────────────
await sleep(1200);
checks.hostPopup = await host.evaluate(() => {
  const text = document.body.innerText;
  return text.includes("Paper Planes") && text.includes("Abspielen") && text.includes("Song-Wunsch");
});
checks.hostPopupAtRight = await host.evaluate(() => {
  const node = [...document.querySelectorAll("div")].find((el) =>
    (el.innerText || "").startsWith("SONG-WUNSCH"),
  );
  if (!node) return false;
  const box = node.getBoundingClientRect();
  return box.right > window.innerWidth * 0.6 && box.top < 200;
});
await host.screenshot({ path: `${OUT}/0.1.52-wish-prompt.png` });

await clickText(host, "Abspielen");
await sleep(2000);

checks.hostQueue = await host.evaluate(() => document.body.innerText.includes("Paper Planes"));
checks.wishGone = await host.evaluate(() => !document.body.innerText.includes("SONG-WUNSCH"));
await host.screenshot({ path: `${OUT}/0.1.52-wish-accepted.png` });

checks.guestNotified = await guest.evaluate(
  () => document.body.innerText.includes("Wunsch angenommen") || document.body.innerText.includes("Paper Planes"),
);

// a phone-sized listener: the same tab must fit without overflow
await guest.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(1500);
await clickText(guest, "Einstellungen");
await sleep(1200);
await guest.evaluate(() => {
  const tabs = [...document.querySelectorAll("[role='tab'], button")];
  const hit = tabs.find((node) => (node.textContent || "").trim() === "Lobby");
  hit?.click();
});
await sleep(900);
await guest.evaluate(() => window.scrollTo(0, 0));
await guest.screenshot({ path: `${OUT}/0.1.52-lobby-phone.png`, fullPage: false });
checks.phoneFits = await guest.evaluate(
  () => document.documentElement.scrollWidth <= window.innerWidth + 1,
);

console.log(JSON.stringify(checks, null, 2));
if (errors.length) console.log("page errors:", errors.slice(0, 5));

await guest.close();
await host.close();
await browser.close();

const failed = Object.entries(checks).filter(([, value]) => !value);
if (failed.length) {
  console.log("FAILED:", failed.map(([key]) => key).join(", "));
  process.exit(1);
}
console.log("all wish checks passed");
