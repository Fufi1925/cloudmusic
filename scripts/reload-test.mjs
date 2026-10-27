import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", date: new Date().toUTCString() };
const json = (b, s = 200) => ({ status: s, contentType: "application/json", headers: CORS, body: JSON.stringify(b) });
const T = [{ type: "track", id: "d1", title: "Midnight Drive", artists: [{ id: "a", name: "Nova Kane" }], durationMs: 180000, cover: { url: "" } }];

async function page(browser, userId, name) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 860 });
  await p.setRequestInterception(true);
  p.on("request", (req) => {
    const u = req.url();
    if (u.includes("127.0.0.1:5201") || u.startsWith("data:") || u.startsWith("blob:")) return req.continue();
    if (u.includes("api.tryliner.fun")) {
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS, body: "" });
      const path = u.split("api.tryliner.fun")[1].split("?")[0];
      if (path === "/v1/me") return req.respond(json({ id: userId, email: null, username: userId, displayName: name, avatarUrl: null }));
      if (path.startsWith("/v1/search")) return req.respond(json({ items: T }));
      return req.respond(json({ items: [], nextCursor: null }));
    }
    return req.abort();
  });
  await p.evaluateOnNewDocument(({ userId, name }) => {
    const user = { id: userId, email: null, username: userId, displayName: name, avatarUrl: null };
    localStorage.setItem("cloudmusic_auth_session", JSON.stringify({ accessToken: "t", refreshToken: "r", user }));
    localStorage.setItem("cloudmusic_locale", "de");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("cloudmusic_lobby_url", "ws://127.0.0.1:4300/v1/lobby/ws");
    sessionStorage.setItem("cloudmusic:env-warning-skipped", "1");
  }, { userId, name });
  await p.goto("http://127.0.0.1:5201/", { waitUntil: "domcontentloaded" });
  await sleep(3000);
  return p;
}
const click = async (p, text) => p.evaluate((label) => {
  let d = null; try { d = document.querySelector(label); } catch {}
  if (d) { d.click(); return true; }
  const hit = [...document.querySelectorAll("button,a,[role=tab]")].find((n) => (n.textContent || "").includes(label));
  if (!hit) return false; hit.click(); return true;
}, text);

const browser = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "new", protocolTimeout: 120000, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
const host = await page(browser, "fufi", "Fufi");
await click(host, 'button[aria-label="Einstellungen"]'); await sleep(1000);
await click(host, "Lobby"); await sleep(600);
await click(host, "Lobby erstellen"); await sleep(2000);
const code = await host.evaluate(() => (document.body.innerText.match(/\b([1-9]\d{3})\b/) || [])[1]);
console.log("code", code);

const guest = await page(browser, "mira", "Mira");
await click(guest, 'button[aria-label="Einstellungen"]'); await sleep(1000);
await click(guest, "Lobby"); await sleep(600);
await guest.click('input[aria-label="Lobby code"]');
await guest.keyboard.type(code, { delay: 30 }); await sleep(300);
await click(guest, "Beitritt anfragen"); await sleep(1500);
await click(host, "Erlauben"); await sleep(1500);

console.log("guest session storage:", await guest.evaluate(() => localStorage.getItem("cloudmusic_lobby_session")));
console.log("guest in lobby:", await guest.evaluate(() => document.body.innerText.includes("Du folgst der Wiedergabe")));

await guest.reload({ waitUntil: "domcontentloaded" });
await sleep(4000);
console.log("after reload session:", await guest.evaluate(() => localStorage.getItem("cloudmusic_lobby_session")));
console.log("after reload in lobby:", await guest.evaluate(() => document.body.innerText.includes("Du folgst der Wiedergabe")));
console.log("after reload text:", (await guest.evaluate(() => document.body.innerText)).slice(0, 200).replace(/\n/g, " | "));
const logs = [];
guest.on("console", (m) => logs.push(m.text()));
await browser.close();
