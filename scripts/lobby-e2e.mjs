// End-to-end check for the lobby: one host, one listener, a real lobby server.
//
//   node server/lobby/index.mjs &
//   node scripts/lobby-e2e.mjs [outdir]
//
// It drives the actual UI (settings → Lobby), so it exercises the websocket
// client, the join-request prompt and the player strip, not just the server.
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
  id: `demoTrack${i + 1}`,
  title: ["Midnight Drive", "Paper Planes", "Golden Hour", "Slow Rivers", "Neon Garden", "Static Bloom", "Velvet Noise", "Afterglow"][i],
  artists: [{ id: `artist${i}`, name: ["Nova Kane", "The Loops", "Mira Sol", "Hollow Coast", "June Atlas", "Pale Waves", "Echo Park", "Sable"][i] }],
  durationMs: 180000 + i * 12000,
  cover: { url: "", width: 480, height: 480 },
}));

async function preparePage(browser, { userId, displayName, width = 1280, height = 820 }) {
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
  await new Promise((resolve) => setTimeout(resolve, 3500));
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

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  protocolTimeout: 120_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"],
});

const errors = [];
const host = await preparePage(browser, { userId: "fufi", displayName: "Fufi" });
host.on("pageerror", (error) => errors.push(`host: ${String(error).slice(0, 200)}`));

await clickText(host, 'button[aria-label="Einstellungen"]');
await new Promise((resolve) => setTimeout(resolve, 1200));
await clickText(host, "Lobby");
await new Promise((resolve) => setTimeout(resolve, 800));
await clickText(host, "Lobby erstellen");
await new Promise((resolve) => setTimeout(resolve, 2500));

const code = await host.evaluate(() => {
  const match = document.body.innerText.match(/\b([1-9]\d{3})\b/);
  return match ? match[1] : null;
});
console.log("host code:", code);
await host.screenshot({ path: `${OUT}/0.1.50-lobby-host.png` });

const guest = await preparePage(browser, { userId: "mira", displayName: "Mira" });
guest.on("pageerror", (error) => errors.push(`guest: ${String(error).slice(0, 200)}`));

await clickText(guest, 'button[aria-label="Einstellungen"]');
await new Promise((resolve) => setTimeout(resolve, 1200));
await clickText(guest, "Lobby");
await new Promise((resolve) => setTimeout(resolve, 800));
await guest.click('input[aria-label="Lobby code"]');
await guest.keyboard.type(code, { delay: 40 });
await new Promise((resolve) => setTimeout(resolve, 500));
console.log("typed code:", await guest.evaluate(() => document.querySelector('input[aria-label="Lobby code"]')?.value));
await clickText(guest, "Beitritt anfragen");
await new Promise((resolve) => setTimeout(resolve, 3000));

const guestPending = await guest.evaluate(() => document.body.innerText.includes("Warte auf den Host"));
console.log("guest waiting for approval:", guestPending);

// the host should now see the yes/no pop-up
await new Promise((resolve) => setTimeout(resolve, 1500));
const promptVisible = await host.evaluate(() => document.body.innerText.includes("möchte beitreten"));
console.log("host prompt visible:", promptVisible);
await host.screenshot({ path: `${OUT}/0.1.50-lobby-prompt.png` });

await clickText(host, "Erlauben");
await new Promise((resolve) => setTimeout(resolve, 3000));

const guestState = await guest.evaluate(() => {
  const text = document.body.innerText.toLowerCase();
  return {
    inLobby: text.includes("du hörst bei"),
    hasCode: text.includes("lobby-code"),
    strip: text.includes("du hörst bei fufi"),
  };
});
console.log("guest state:", JSON.stringify(guestState));

// close the settings so the player strip is visible in the shot
await guest.evaluate(() => document.querySelector('button[aria-label="Schließen"]')?.click());
await new Promise((resolve) => setTimeout(resolve, 1200));
await guest.screenshot({ path: `${OUT}/0.1.50-lobby-listener.png` });

const hostStrip = await host.evaluate(() => document.body.innerText.includes("hört zu") || document.body.innerText.includes("hören zu"));
console.log("host strip:", hostStrip);
await host.evaluate(() => document.querySelector('button[aria-label="Schließen"]')?.click());
await new Promise((resolve) => setTimeout(resolve, 1200));
await host.screenshot({ path: `${OUT}/0.1.50-lobby-host-plain.png` });

await guest.close();

// a phone-sized listener re-attaches with the same account (no new approval)
const phone = await preparePage(browser, { userId: "mira", displayName: "Mira", width: 390, height: 844 });
phone.on("pageerror", (error) => errors.push(`phone: ${String(error).slice(0, 200)}`));
await clickText(phone, "Einstellungen");
await new Promise((resolve) => setTimeout(resolve, 1500));
await clickText(phone, "Lobby");
await new Promise((resolve) => setTimeout(resolve, 900));
await phone.screenshot({ path: `${OUT}/0.1.50-lobby-phone-tab.png` });
console.log("phone tab has code field:", await phone.evaluate(() => !!document.querySelector('input[aria-label="Lobby code"]')));
await phone.click('input[aria-label="Lobby code"]');
await phone.keyboard.type(code, { delay: 40 });
await new Promise((resolve) => setTimeout(resolve, 400));
await clickText(phone, "Beitritt anfragen");
await new Promise((resolve) => setTimeout(resolve, 3000));
await phone.screenshot({ path: `${OUT}/0.1.50-lobby-phone.png` });
console.log("phone rejoined:", await phone.evaluate(() => document.body.innerText.toLowerCase().includes("du hörst bei")));

if (errors.length) console.log("PAGE ERRORS:", errors.join("\n"));
await browser.close();
