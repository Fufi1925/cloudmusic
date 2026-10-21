import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
  const user = { id: "u1", email: "d@x", username: "d", displayName: "D", avatarUrl: null };
  localStorage.setItem("cloudmusic_auth_session", JSON.stringify({ accessToken: "t", refreshToken: "r", user }));
  sessionStorage.setItem("cloudmusic:env-warning-skipped", "1");
});
await page.setRequestInterception(true);
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("127.0.0.1:5199") || u.startsWith("data:")) return r.continue();
  return r.abort();
});
await page.goto("http://127.0.0.1:5199/#/player", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));
console.log(await page.evaluate(() => {
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute("content");
  const widest = [...document.querySelectorAll("body *")]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((x) => x.r.width > 400)
    .slice(0, 8)
    .map((x) => ({ tag: x.el.tagName, cls: String(x.el.className).slice(0, 100), w: Math.round(x.r.width) }));
  const headHtml = document.head ? document.head.innerHTML.slice(0, 400) : "NO HEAD";
  return { headHtml, href: location.href, title: document.title, vp, metas: [...document.querySelectorAll("meta")].map((m) => m.getAttribute("name") + "=" + m.getAttribute("content")), innerWidth: window.innerWidth, docClient: document.documentElement.clientWidth, body: document.body.getBoundingClientRect().width, widest };
}));
await browser.close();
