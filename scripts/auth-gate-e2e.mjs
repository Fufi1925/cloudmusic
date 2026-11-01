// End-to-end proof of the auth gate (proof of work + turnstile) without the real
// api: a mock server speaks the same protocol and the real built app drives it.
//
//   VITE_API_URL=http://127.0.0.1:5201 npx vite build --config vite.web.config.ts --outDir dist-web
//   node scripts/auth-gate-e2e.mjs [outdir]
//
// The mock serves the bundle and the api on one origin so the embedded turnstile
// page can postMessage back. It verifies the proof of work it receives by
// recomputing argon2id, exactly like the server would.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { argon2id } from "hash-wasm";

const PORT = Number(process.env.E2E_PORT || 5201);
const ROOT = process.env.WEB_ROOT || "/home/user/desktop/dist-web";
const OUT = process.argv[2] || "/home/user/shots";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// E2E_SILENT=1: the verify page loads but never posts a token - the exact shape
// of the bug where the panel stayed grey forever
const SILENT = process.env.E2E_SILENT === "1";
// E2E_MOBILE=1: portrait phone viewport, to check the compact (bottom sheet) panel
const MOBILE = process.env.E2E_MOBILE === "1";
const SUFFIX = MOBILE ? "-mobile" : "";
let verifyHits = 0;

const CHECK_TOKEN = "turnstile-e2e-token";
const SALT_TEXT = "saltsalt";
const SALT_B64URL = Buffer.from(SALT_TEXT).toString("base64url");
const DIFFICULTY = 7;

const log = [];
let issued = 0;
let challenge = null;
const pending = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function json(res, body, status = 200) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": ORIGIN,
    "access-control-allow-credentials": "true",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function leadingZeroBits(bytes) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    });
    return res.end();
  }

  if (url.pathname !== "/" && !url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/assets/")) {
    log.push({ event: "http", method: req.method, path: url.pathname });
  }

  if (url.pathname === "/v1/auth/challenge" && req.method === "POST") {
    const body = await readBody(req);
    issued += 1;
    challenge = {
      mode: "required",
      algorithm: "argon2id-v1",
      token: `challenge-${issued}`,
      salt: SALT_B64URL,
      difficulty: DIFFICULTY,
      memoryKiB: 16,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      turnstile: { mode: "required", edge: false },
    };
    log.push({ event: "challenge", purpose: body.purpose, email: body.email });
    return json(res, challenge);
  }

  if (url.pathname === "/v1/auth/verify") {
    // stands in for the api's turnstile page: solves immediately and posts the token
    verifyHits += 1;
    const action = url.searchParams.get("action") || "login";
    const script = SILENT
      ? ""
      : `setTimeout(() => {
    document.getElementById("s").textContent = "verified";
    parent.postMessage({ source: "liner-turnstile", action: ${JSON.stringify(action)}, type: "token", token: ${JSON.stringify(CHECK_TOKEN)} }, "*");
  }, 2500);`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Verify</title></head>
<body style="margin:0;display:grid;place-items:center;height:100vh;font:13px system-ui;background:#101014;color:#eee">
<div id="s">human check…</div>
<script>
  ${script}
</script>
</body></html>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (url.pathname === "/v1/auth/register" && req.method === "POST") {
    const body = await readBody(req);
    const problems = [];
    if (!body.email || !body.password || !body.username) problems.push("missing fields");
    if (body.turnstile !== CHECK_TOKEN) problems.push(`bad turnstile ${body.turnstile}`);
    if (!body.pow || body.pow.token !== challenge?.token) problems.push("missing/stale proof");
    else {
      const hash = await argon2id({
        password: `${body.pow.token}:${body.pow.nonce}`,
        salt: new TextEncoder().encode(SALT_TEXT),
        parallelism: challenge.parallelism,
        iterations: challenge.iterations,
        memorySize: challenge.memoryKiB,
        hashLength: challenge.hashLength,
        outputType: "binary",
      });
      const bits = leadingZeroBits(hash);
      if (bits < challenge.difficulty) problems.push(`weak proof (${bits} bits)`);
      log.push({ event: "register", nonce: body.pow.nonce, bits });
    }
    if (problems.length) {
      log.push({ event: "register-rejected", problems });
      return json(res, { code: "POW_INVALID", message: problems.join(", ") }, 400);
    }
    const user = {
      id: "u-new",
      email: body.email,
      username: body.username,
      displayName: body.displayName,
      avatarUrl: null,
    };
    return json(res, {
      accessToken: "e2e-access",
      refreshToken: "e2e-refresh",
      user,
    });
  }

  if (url.pathname === "/v1/me") {
    return json(res, {
      id: "u-new",
      email: "new@example.com",
      username: "neuling",
      displayName: "Neuling",
      avatarUrl: null,
    });
  }

  if (url.pathname.startsWith("/v1/")) {
    // everything the app asks for after login: empty but well-formed
    return json(res, { items: [], nextCursor: null });
  }

  // static bundle
  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  const file =
    relative.includes(".")
      ? path.join(ROOT, relative)
      : path.join(ROOT, "index.html");
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
    });
    return res.end(data);
  } catch {
    try {
      const html = await readFile(path.join(ROOT, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      return res.end(html);
    } catch {
      res.writeHead(404);
      return res.end("not found");
    }
  }
});

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  protocolTimeout: 120_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.setViewport(
    MOBILE
      ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { width: 1280, height: 860, deviceScaleFactor: 1 },
  );
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("cloudmusic_locale", "de");
    localStorage.setItem("theme", "dark");
  });

  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT}/0.1.54-auth-login${SUFFIX}.png` });

  // switch to "Konto erstellen"
  const clickedTab = await page.evaluate(() => {
    // mode tabs sit above the form; the submit lives inside it
    const tabs = [...document.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Konto erstellen",
    );
    const target = tabs.find((b) => !b.closest("form")) ?? tabs[0];
    target?.click();
    return Boolean(target);
  });
  check("register tab reachable", clickedTab);
  await new Promise((r) => setTimeout(r, 600));

  // step 1: email + passwords
  const filledStep1 = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")];
    const set = (el, value) => {
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    const email = inputs.find((i) => i.type === "email") || inputs[0];
    const passwords = inputs.filter((i) => i.type === "password");
    set(email, "neu@example.com");
    if (passwords[0]) set(passwords[0], "supergeheim1");
    if (passwords[1]) set(passwords[1], "supergeheim1");
    const next = [...document.querySelectorAll('button[type="submit"]')].pop();
    next?.click();
    return { email: Boolean(email), passwords: passwords.length, next: Boolean(next) };
  });
  check("step 1 filled", filledStep1.email && filledStep1.passwords >= 2 && filledStep1.next, JSON.stringify(filledStep1));
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/0.1.54-auth-step2${SUFFIX}.png` });

  // watch for the human-check panel from inside the page: the proof is solved in
  // a few hundred ms, so polling from node would miss it
  await page.evaluate(() => {
    window.__sawHumanCheck = false;
    const inspect = () => {
      const headings = [...document.querySelectorAll("h2")].map((h) => h.textContent?.trim());
      const frames = [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("title"));
      if (headings.length || frames.length) window.__seenHeads = headings;
      if (frames.length) window.__seenFrames = frames;
      const frame = document.querySelector('iframe[src*="/v1/auth/verify"]');
      if (frame) {
        window.__sawHumanCheck = true;
        window.__checkFrameTitle = frame.getAttribute("title");
      }
    };
    inspect();
    window.__humanCheckObserver?.disconnect?.();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    window.__humanCheckObserver = observer;
  });

  // step 2: username + display name are pre-filled from the email; submit
  const submitted = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")];
    const set = (el, value) => {
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    const username = inputs.find((i) => (i.placeholder || "").toLowerCase().includes("soundwave"));
    const display = inputs.find((i) => (i.placeholder || "").toLowerCase().includes("alias"));
    set(username, "neuling");
    set(display, "Neuling");
    // the label "Konto erstellen" exists twice (mode tab + submit): take the submit
    const submit = [...document.querySelectorAll('button[type="submit"]')].pop();
    submit?.click();
    return { username: Boolean(username), display: Boolean(display), submit: Boolean(submit) };
  });
  check("step 2 submitted", submitted.submit, JSON.stringify(submitted));

  // grab the panel while the turnstile page is still loading
  for (let i = 0; i < 60; i += 1) {
    const up = await page.evaluate(
      () => Boolean(document.querySelector('iframe[src*="/v1/auth/verify"]')),
    );
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // let the panel finish its spring animation before the screenshot
  await new Promise((r) => setTimeout(r, 450));
  await page.screenshot({ path: `${OUT}/0.1.54-auth-human-check${SUFFIX}.png` });

  // wait for registration to land
  let session = null;
  for (let i = 0; i < 80; i += 1) {
    session = await page.evaluate(() => {
      const raw = localStorage.getItem("cloudmusic_auth_session");
      return raw ? JSON.parse(raw) : null;
    });
    if (session?.accessToken === "e2e-access") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!SILENT)
    check("account created (session stored)", session?.accessToken === "e2e-access", JSON.stringify(session?.user || null));

  // the panel shows up while the proof is solved / the turnstile page runs
  const panelDebug = await page.evaluate(() => ({
    saw: window.__sawHumanCheck === true,
    frameTitle: window.__checkFrameTitle || null,
    heads: window.__seenHeads || null,
    frames: window.__seenFrames || null,
  }));
  console.log("panel debug:", JSON.stringify(panelDebug));
  const sawPanel = panelDebug.saw === true;
  check("human check panel shown with the turnstile iframe", sawPanel);

  if (SILENT) {
    // the widget never answers: the panel has to end on its own, once
    let closed = false;
    let framesSeen = 0;
    for (let i = 0; i < 200; i += 1) {
      const state = await page.evaluate(() => {
        const frame = document.querySelector('iframe[src*="/v1/auth/verify"]');
        return { frame: Boolean(frame), text: document.body.innerText };
      });
      if (state.frame) framesSeen += 1;
      else if (framesSeen > 0) {
        closed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    check("panel stops spinning (closes on its own)", closed);
    const text = await page.evaluate(() => document.body.innerText);
    check("error names the security check", /Sicherheitspr\u00fcfung/i.test(text), text.slice(0, 180).replace(/\n/g, " | "));
    check("no endless widget reload", verifyHits <= 3, `verify requested ${verifyHits}x`);
    await page.screenshot({ path: `${OUT}/0.1.54-auth-check-timeout${SUFFIX}.png` });
    console.log("page errors:", JSON.stringify(errors.slice(0, 8), null, 1));
    await browser.close().catch(() => {});
    const failedSilent = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failedSilent.length}/${checks.length} checks passed`);
    process.exit(failedSilent.length ? 1 : 0);
  }

  const registerCall = log.find((entry) => entry.event === "register");
  check("server accepted a strong proof", Boolean(registerCall) && registerCall.bits >= DIFFICULTY, JSON.stringify(registerCall || null));
  check("challenge requested for register", log.some((e) => e.event === "challenge" && e.purpose === "register"));
  if (!sawPanel) console.log("server log:", JSON.stringify(log.filter((e) => e.event !== "http")));
  check("no register rejection", !log.some((e) => e.event === "register-rejected"), JSON.stringify(log.filter((e) => e.event === "register-rejected")));

  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${OUT}/0.1.54-auth-after${SUFFIX}.png` });

  // the standalone web build tries third-party things electron normally allows
  console.log("page errors:", JSON.stringify(errors.slice(0, 8), null, 1));

  const IGNORED = [
    /favicon/i,
    /ERR_/i,
    /Failed to load resource/i,
    /youtube\.com\/sw\.js_data/i, // service-worker probe, allowed in electron only
    /music\.youtube\.com\/youtubei/i, // innertube calls; electron patches CORS
    /youtubei\/v1/i,
    /\/v1\/ping\/ws/i, // presence socket of the desktop app
    /WebSocket connection to/i,
    /VisitorSession/i,
  ];
  const fatal = errors.filter((e) => !IGNORED.some((re) => re.test(e)));
  check("no page errors", fatal.length === 0, fatal.slice(0, 3).join(" | "));
  console.log("server log:", JSON.stringify(log, null, 1));
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
