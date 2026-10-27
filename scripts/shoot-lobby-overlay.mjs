// Screenshot of the desktop lobby overlay (#/lobby-overlay) without Electron:
// a fake window.cloudMusicElectron feeds the panel a demo snapshot.
//
//   node scripts/shoot-lobby-overlay.mjs [outdir]
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:5201/";
const OUT = process.argv[2] || "/home/user/shots";

const DEMO_STATE = {
  active: true,
  role: "host",
  code: "8018",
  hostName: "Fufi",
  meId: "fufi",
  members: [
    { userId: "mira", name: "Mira", online: true },
    { userId: "jonas", name: "Jonas", online: true },
    { userId: "lena", name: "Lena", online: false },
  ],
  current: { title: "Midnight Drive", artists: "Nova Kane", coverUrl: "" },
  next: [
    { id: "d2", title: "Paper Planes", artists: "The Loops" },
    { id: "d3", title: "Golden Hour", artists: "Mira Sol" },
  ],
  requests: [{ id: "r1", title: "Neon Garden", name: "Jonas", votes: 2 }],
  votes: { skip: 1, skipNeeded: 2 },
};

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  protocolTimeout: 120_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const page = await browser.newPage();
await page.setViewport({ width: 296, height: 360, deviceScaleFactor: 2 });
await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = req.url();
  if (url.includes("127.0.0.1:5201") || url.startsWith("data:") || url.startsWith("blob:")) return req.continue();
  return req.abort();
});

await page.evaluateOnNewDocument((state) => {
  localStorage.setItem("theme", "dark");
  localStorage.setItem("cloudmusic_locale", "de");
  window.__lobbyOverlayActions = [];
  window.cloudMusicElectron = {
    platform: "linux",
    getLobbyOverlayInitialState: async () => state,
    onLobbyOverlayState: () => () => {},
    onLobbyOverlayVisibility: () => () => {},
    sendLobbyOverlayAction: (action) => window.__lobbyOverlayActions.push(action),
  };
}, DEMO_STATE);

await page.goto(`${APP_URL}#/lobby-overlay`, { waitUntil: "domcontentloaded", timeout: 45000 });
await new Promise((resolve) => setTimeout(resolve, 1800));

// a wallpaper so the transparent corners look like a real desktop
await page.evaluate(() => {
  document.documentElement.style.background = "linear-gradient(140deg, #2b2f3a 0%, #14161b 60%, #0b0c0f 100%)";
  document.body.style.background = "transparent";
});
await page.screenshot({ path: `${OUT}/0.1.52-lobby-overlay.png` });

// right-click a listener -> kick menu
const opened = await page.evaluate(() => {
  const row = document.querySelector('[data-member="mira"]');
  if (!row) return false;
  const box = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 40,
      clientY: box.top + 8,
    }),
  );
  return true;
});
console.log("context menu opened:", opened);
await new Promise((resolve) => setTimeout(resolve, 500));
await page.screenshot({ path: `${OUT}/0.1.52-lobby-overlay-menu.png` });

const menuText = await page.evaluate(() => document.body.innerText);
console.log("menu has kick:", menuText.includes("Kicken"));
console.log("menu has reset:", menuText.includes("Position zurücksetzen"));

await browser.close();
