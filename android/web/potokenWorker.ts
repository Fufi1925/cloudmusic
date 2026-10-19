// potoken-worker.js: port of electron/potoken-preload.ts.
//
// Injected by PoTokenService.java into a hidden WebView that has
// https://www.youtube.com/robots.txt loaded (same page electron uses), so
// BotGuard runs in a genuine youtube.com origin. ipcRenderer is replaced by the
// CloudMusicPoBridge java interface; everything else is the original logic.
import { BotGuardClient } from "bgutils-js/botguard";
import { buildURL, GOOG_API_KEY } from "bgutils-js/utils";
import { WebPoMinter } from "bgutils-js/webpo";

interface PoBridge {
  ready(): void;
  result(json: string): void;
  interpreter(requestId: number, url: string): void;
}

declare global {
  interface Window {
    CloudMusicPoBridge?: PoBridge;
    __cloudMusicPoWorker?: {
      mint: (id: number, identifier: string) => void;
      interpreterResult: (requestId: number, text: string | null, error: string | null) => void;
    };
  }
}

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const WEB_CLIENT_VERSION = "2.20250925.01.00";

interface MinterEntry {
  minter: WebPoMinter;
  expiresAt: number;
}

interface BgChallenge {
  interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string };
  program?: string;
  globalName?: string;
}

let current: MinterEntry | null = null;
let pending: Promise<MinterEntry> | null = null;

const interpreterRequests = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
let interpreterSeq = 0;

// replaces ipcRenderer.invoke("potoken:interpreter", url): the native side
// downloads the script (google / gstatic only) since it is cross-origin here
function downloadInterpreter(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = ++interpreterSeq;
    interpreterRequests.set(requestId, { resolve, reject });
    try {
      window.CloudMusicPoBridge!.interpreter(requestId, url);
    } catch (error) {
      interpreterRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function fetchChallenge(): Promise<{ interpreterUrl: string; program: string; globalName: string }> {
  const response = await fetch("/youtubei/v1/att/get?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: WEB_CLIENT_VERSION, hl: "en", gl: "US" } },
      engagementType: "ENGAGEMENT_TYPE_UNBOUND",
    }),
  });
  if (!response.ok) throw new Error(`att/get returned ${response.status}`);
  const challenge = ((await response.json()) as { bgChallenge?: BgChallenge }).bgChallenge;
  const interpreterUrl = challenge?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (!interpreterUrl || !challenge?.program || !challenge.globalName) throw new Error("BotGuard challenge is missing");
  return { interpreterUrl, program: challenge.program, globalName: challenge.globalName };
}

async function createMinter(): Promise<MinterEntry> {
  const { interpreterUrl, program, globalName } = await fetchChallenge();
  const script = await downloadInterpreter(`https:${interpreterUrl}`);
  new Function(script)();
  const botguard = await BotGuardClient.create({ program, globalName, globalObject: globalThis });
  const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
  const response = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });
  if (!response.ok) throw new Error(`GenerateIT returned ${response.status}`);
  const [integrityToken, ttlSeconds] = (await response.json()) as [string | null, number?];
  if (!integrityToken) throw new Error("GenerateIT returned no integrity token");
  const minter = await WebPoMinter.create({ integrityToken }, webPoSignalOutput);
  const ttlMs = (typeof ttlSeconds === "number" && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS) * 1000;
  return { minter, expiresAt: Date.now() + Math.max(ttlMs - REFRESH_MARGIN_MS, 60_000) };
}

async function getMinter(): Promise<MinterEntry> {
  if (current && Date.now() < current.expiresAt) return current;
  if (!pending) {
    pending = createMinter()
      .then((entry) => {
        current = entry;
        return entry;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

function report(payload: { id: number; token?: string; error?: string }): void {
  try {
    window.CloudMusicPoBridge?.result(JSON.stringify(payload));
  } catch {
    // service torn down
  }
}

(function startPoTokenWorker() {
  if (window.__cloudMusicPoWorker || !window.CloudMusicPoBridge) return;
  window.__cloudMusicPoWorker = {
    mint(id, identifier) {
      void (async () => {
        try {
          const entry = await getMinter();
          const token = await entry.minter.mintAsWebsafeString(identifier);
          report({ id, token });
        } catch (error) {
          current = null;
          report({ id, error: error instanceof Error ? error.message : String(error) });
        }
      })();
    },
    interpreterResult(requestId, text, error) {
      const request = interpreterRequests.get(requestId);
      if (!request) return;
      interpreterRequests.delete(requestId);
      if (typeof text === "string" && !error) request.resolve(text);
      else request.reject(new Error(error || "interpreter download failed"));
    },
  };
  window.CloudMusicPoBridge.ready();
})();
