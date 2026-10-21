import puppeteer from "puppeteer-core";

// usage: node scripts/shoot.mjs <url> <out.png> [w] [h] [hash] [--seed]
const url = process.argv[2] || "http://127.0.0.1:5199/";
const out = process.argv[3] || "/tmp/shot.png";
const width = Number(process.argv[4] || 390);
const height = Number(process.argv[5] || 844);
const hash = process.argv[6] || "";
const seed = process.argv.includes("--seed");
// --wallpaper seeds a tiny gradient wallpaper so the customisation controls render
const seedWallpaper = process.argv.includes("--wallpaper");

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 768, hasTouch: width < 768 });
await page.setRequestInterception(true);

// small fake backend so the signed-in shell renders without network access
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

const seen = [];
page.on("request", (req) => {
  const u = req.url();
  if (u.includes("127.0.0.1:5199") || u.startsWith("data:")) return req.continue();
  seen.push(u.replace("https://api.tryliner.fun", ""));
  if (u.includes("api.tryliner.fun")) {
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS, body: "" });
    const path = u.split("api.tryliner.fun")[1].split("?")[0];
    if (path === "/v1/me") {
      return req.respond(json({ id: "user_demo_1", email: "demo@cloudmusic.local", username: "demo", displayName: "Demo User", avatarUrl: null }));
    }
    if (path.startsWith("/v1/search")) return req.respond(json({ items: TRACKS, results: TRACKS }));
    if (path.startsWith("/v1/explore/popular")) return req.respond(json({ items: TRACKS }));
    if (path.startsWith("/v1/me/history")) return req.respond(json({ items: TRACKS.slice(0, 5) }));
    if (path.startsWith("/v1/me/recommendations/daily-mixes"))
      return req.respond(json({ items: [{ id: "mix1", title: "Daily Mix 1", description: "Für dich", cover: { url: "" }, tracks: TRACKS }] }));
    if (path.includes("/lyrics")) {
      // minimal SSE stream so the full screen lyrics page can be captured
      const lrc = Array.from({ length: 24 }, (_, i) => {
        const t = 8 + i * 6;
        const mm = String(Math.floor(t / 60)).padStart(2, "0");
        const ss = String(t % 60).padStart(2, "0");
        return `[${mm}:${ss}.00] Line ${i + 1} of the demo song`;
      }).join("\n");
      const body = [
        "data: " + JSON.stringify({ type: "metadata", track: { id: "demoTrack1", title: "Midnight Drive", artists: [], durationMs: 194000 } }),
        "",
        "data: " + JSON.stringify({
          type: "provider",
          provider: "demo",
          status: "found",
          syncLevel: "line_level",
          candidate: {
            provider: "demo",
            lyrics: { format: "lrc", content: lrc },
            contentKind: "line_synced",
            syncLevel: "line_level",
            quality: { total: 90, match: 90, content: 90, sync: 90, source: 90, reasons: [] },
          },
        }),
        "",
        "",
      ].join("\n");
      return req.respond({
        status: 200,
        headers: { ...CORS, "content-type": "text/event-stream" },
        body,
      });
    }
    if (path === "/health") return req.respond(json({ ok: true }));
    if (path.includes("/radio")) return req.respond(json({ items: TRACKS }));
    if (path.includes("/library/tracks"))
      return req.respond(
        json({
          items: Array.from({ length: 24 }, (_, i) => TRACKS[i % TRACKS.length]).map((t, i) => ({
            track: { ...t, id: `${t.id}_${i}`, title: `${t.title} ${i + 1}`, cover: { url: "", width: 480, height: 480 } },
            likedAt: new Date().toISOString(),
          })),
          nextCursor: null,
        }),
      );
    if (path.includes("/me/playlists")) return req.respond(json({ items: [{ id: "pl1", title: "Roadtrip", description: "", trackCount: 12 }] }));
    if (path.includes("/library/")) return req.respond(json({ items: [] }));
    return req.respond(json({ items: [], nextCursor: null }));
  }
  return req.abort();
});
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 200)}`));

if (seed) {
  await page.evaluateOnNewDocument(() => {
    const user = {
      id: "user_demo_1",
      email: "demo@cloudmusic.local",
      username: "demo",
      displayName: "Demo User",
      avatarUrl: null,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(
      "cloudmusic_auth_session",
      JSON.stringify({ accessToken: "demo_token", refreshToken: "demo_refresh", user }),
    );
    localStorage.setItem("cloudmusic_locale", "de");
    localStorage.setItem("theme", "dark");
    // a running queue so the compact player bar + queue sheet can be captured
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
  });
}

// wallpaper seeding runs in its own script so the flag is serialised in
if (seedWallpaper) {
  await page.evaluateOnNewDocument(() => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#1b2a4a"/><stop offset="0.5" stop-color="#4a2d5e"/>' +
      '<stop offset="1" stop-color="#0f172a"/></linearGradient></defs>' +
      '<rect width="24" height="24" fill="url(#g)"/></svg>';
    localStorage.setItem(
      "cloudmusic_customization_v1",
      JSON.stringify({
        state: {
          backgroundImage: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
          backgroundBlur: 6,
          backgroundDim: 12,
          backgroundFit: "cover",
          backgroundSaturation: 120,
          backgroundKenBurns: true,
          sidebar: { opacity: 60, blur: 20, dim: 15 },
          contentView: { opacity: 72, blur: 18, dim: 12 },
          miniplayer: { opacity: 60, blur: 20, dim: 15 },
        },
        version: 0,
      }),
    );
  });
}

await page.goto(url + "#/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => logs.push("goto: " + e.message));
await new Promise((r) => setTimeout(r, 2000));
if (hash && hash !== "/") {
  // warm navigation keeps hash routing inside the same document (no reload)
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}
await new Promise((r) => setTimeout(r, 4500));

// --scroll=<px> scrolls the deepest scrollable container before the shot
const scrollArg = process.argv.find((a) => a.startsWith("--scroll="));
if (scrollArg) {
  const amount = Number(scrollArg.split("=")[1]) || 0;
  await page.evaluate((px) => {
    const all = [...document.querySelectorAll("div, main, section")].filter((el) => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 20;
    });
    for (const el of all) el.scrollTop = px;
  }, amount);
  await new Promise((r) => setTimeout(r, 900));
}

// --click=<visible text> presses the first matching button/link; repeatable
for (const arg of process.argv.filter((a) => /^--click(\d*)=/.test(a))) {
  const label = arg.split("=")[1];
  const clicked = await page.evaluate((text) => {
    const nodes = [...document.querySelectorAll("button, a, [role='tab'], [role='button'], input")];
    const hit = nodes.find((n) => (n.textContent || "").trim().includes(text) || (n.getAttribute && (n.getAttribute("aria-label") || "").includes(text)));
    if (!hit) return false;
    hit.click();
    return true;
  }, label);
  if (!clicked) console.log("CLICK MISS:", label);
  await new Promise((r) => setTimeout(r, 2200));
}

const overflow = await page.evaluate(() => {
  const docW = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > docW + 1 || r.left < -1) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 90),
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
        text: (el.textContent || "").trim().slice(0, 50),
      });
    }
  }
  return { href: location.href, docW, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 25) };
});
console.log(JSON.stringify(overflow, null, 1));

// --probe=css-selector prints the geometry of matching nodes (debugging helper)
const probeArg = process.argv.find((a) => a.startsWith("--probe="));
if (probeArg) {
  const sel = probeArg.slice("--probe=".length);
  const info = await page.evaluate((s) => {
    const nodes = [...document.querySelectorAll(s)];
    return {
      innerH: window.innerHeight,
      count: nodes.length,
      nodes: nodes.slice(0, 6).map((n) => {
        const r = n.getBoundingClientRect();
        return { tag: n.tagName.toLowerCase(), cls: (n.className || "").toString().slice(0, 80), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), text: (n.textContent || "").trim().slice(0, 30) };
      }),
    };
  }, sel);
  console.log("PROBE:", JSON.stringify(info, null, 1));
}
if (process.argv.includes("--paths")) console.log("PATHS:", [...new Set(seen)].join("\n"));
if (logs.length) console.log("LOGS:", logs.slice(0, 40).join("\n"));
await page.screenshot({ path: out, fullPage: false });
await browser.close();
