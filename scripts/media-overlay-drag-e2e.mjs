// Media overlay (miniplayer pill) drag e2e — no Electron needed.
//
//   node scripts/media-overlay-drag-e2e.mjs [outdir]
//
// Serves the built web bundle, fakes window.cloudMusicElectron, then drags the
// pill with real pointer events and checks that:
//   • a body drag  -> startOverlayDrag, >=1 moveOverlayDrag, endOverlayDrag
//   • a button click -> no drag ipc at all, but the action still fires
//   • double click on the body -> resetOverlayPosition
//   • the pill renders and is screenshotted
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:5201/";
const OUT = process.argv[2] || "/home/user/shots";

const OVERLAY_STATE = {
  status: "playing",
  track: {
    id: "demo1",
    title: "Midnight Drive",
    artist: "Nova Kane",
    coverUrl: "",
  },
  positionMs: 42_000,
  durationMs: 194_000,
  volume: 0.7,
  isLiked: false,
};

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  protocolTimeout: 120_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

async function run(platform) {
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 56, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("127.0.0.1:5201") || url.startsWith("data:") || url.startsWith("blob:")) {
      return req.continue();
    }
    return req.abort();
  });

  await page.evaluateOnNewDocument(({ state, platform }) => {
    const user = { id: "demo", email: "demo@demo.local", username: "demo", displayName: "Demo", avatarUrl: null };
    localStorage.setItem(
      "cloudmusic_auth_session",
      JSON.stringify({ accessToken: "demo_token", refreshToken: "demo_refresh", user }),
    );
    localStorage.setItem("cloudmusic_locale", "de");
    localStorage.setItem("theme", "dark");

    window.__overlayCalls = { start: 0, move: 0, end: 0, reset: 0, actions: [] };
    window.cloudMusicElectron = {
      platform,
      getOverlayInitialState: async () => state,
      onOverlayState: () => () => {},
      onOverlayVisibility: () => () => {},
      updateOverlaySettings: () => {},
      pauseOverlayShortcuts: () => {},
      sendOverlayAction: (action) => window.__overlayCalls.actions.push(action),
      startOverlayDrag: () => window.__overlayCalls.start++,
      moveOverlayDrag: () => window.__overlayCalls.move++,
      endOverlayDrag: () => window.__overlayCalls.end++,
      resetOverlayPosition: async () => {
        window.__overlayCalls.reset++;
        return true;
      },
    };
  }, { state: OVERLAY_STATE, platform });

  await page.goto(`${APP_URL}#/overlay`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await new Promise((r) => setTimeout(r, 1500));

  const surface = await page.$("[data-overlay-drag-surface]");
  check("drag surface rendered", Boolean(surface));

  const box = surface ? await surface.boundingBox() : null;
  check("pill visible", Boolean(box && box.width > 100 && box.height > 20), box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no box");

  await page.screenshot({ path: `${OUT}/0.1.52-media-overlay.png` });

  // ── drag the empty body area (left side, above the artwork/title block is
  // still part of it; the buttons sit on the right)
  const resetCalls = () => page.evaluate(() => window.__overlayCalls);
  const before = await resetCalls();
  check("no drag ipc before interacting", before.start === 0 && before.move === 0 && before.end === 0);

  const startX = 60;
  const startY = 28;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(startX + i * 6, startY + i * 2);
  }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));

  const afterDrag = await resetCalls();
  if (platform === "linux") {
    // linux: the compositor moves the window (css app-region), no ipc needed
    check("[linux] no ipc drag, app-region set", afterDrag.start === 0, `start=${afterDrag.start}`);
    const region = await page.evaluate(() => {
      const el = document.querySelector("[data-overlay-drag-surface]");
      return el ? getComputedStyle(el).webkitAppRegion || getComputedStyle(el).getPropertyValue("-webkit-app-region") : "";
    });
    check("[linux] css drag region present", String(region).includes("drag"), String(region));
  } else {
    check("drag started once", afterDrag.start === 1, `start=${afterDrag.start}`);
    check("drag moved while dragging", afterDrag.move >= 4, `move=${afterDrag.move}`);
    check("drag ended once", afterDrag.end === 1, `end=${afterDrag.end}`);
  }

  // ── a click on the play/pause button must not drag the window
  const buttons = await page.$$("[data-overlay-drag-surface] button");
  check("buttons present", buttons.length >= 4, `${buttons.length} buttons`);
  const playBox = buttons.length >= 3 ? await buttons[2].boundingBox() : null;
  const before2 = await resetCalls();
  if (playBox) {
    await page.mouse.move(playBox.x + playBox.width / 2, playBox.y + playBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(playBox.x + playBox.width / 2 + 10, playBox.y + playBox.height / 2 + 6);
    await page.mouse.up();
  }
  await new Promise((r) => setTimeout(r, 250));
  const afterButton = await resetCalls();
  check("button press sends no drag ipc", afterButton.start === before2.start && afterButton.end === before2.end);
  const played = afterButton.actions.some((a) => a.type === "togglePlay");
  check("button press still sends its action", played, JSON.stringify(afterButton.actions));

  // ── double click on the body resets the position
  const before3 = await resetCalls();
  await page.mouse.click(startX, startY, { clickCount: 1 });
  await page.mouse.click(startX, startY, { clickCount: 2 });
  await new Promise((r) => setTimeout(r, 250));
  const afterDbl = await resetCalls();
  check("double click resets position", afterDbl.reset > before3.reset, `reset=${afterDbl.reset}`);

  await page.screenshot({ path: `${OUT}/0.1.52-media-overlay-drag.png` });
  await page.close();
}

try {
  console.log("— windows/macos path (ipc drag) —");
  await run("win32");
  console.log("\n— linux path (native app-region) —");
  await run("linux");
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
