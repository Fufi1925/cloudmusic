// Keeps a short, human-readable trace of the last sign-in attempt.
//
// The auth flow talks to a server we do not control and embeds a third-party
// verification page, so when something fails the app has to be able to say
// *what* failed (status, code, which step) instead of "something went wrong".
// The trace is meant to be readable in a screenshot.
export type AuthTraceEntry = { at: number; step: string; detail?: string };

const MAX_ENTRIES = 14;
/** last cloudflare ray id seen on a blocked response */
let lastRay: string | null = null;
let entries: AuthTraceEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // a broken subscriber must not break the auth flow
    }
  }
}

export function recordAuthStep(step: string, detail?: unknown): void {
  const text =
    detail === undefined
      ? undefined
      : typeof detail === "string"
        ? detail
        : (() => {
            try {
              return JSON.stringify(detail);
            } catch {
              return String(detail);
            }
          })();
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), { at: Date.now(), step, detail: text }];
  if (typeof console !== "undefined") {
    console.info(`[auth] ${step}${text ? ` ${text}` : ""}`);
  }
  notify();
}

export function resetAuthTrace(): void {
  entries = [];
  lastRay = null;
  notify();
}

export function setLastBlockRay(ray: string | null): void {
  lastRay = ray;
}

export function getLastBlockRay(): string | null {
  return lastRay;
}

/** what the network stack of the platform reports (android: navigator.connection) */
export function connectionLabel(): string {
  if (typeof navigator === "undefined") return "-";
  const connection = (navigator as unknown as {
    connection?: { type?: string; effectiveType?: string; downlink?: number };
  }).connection;
  if (!connection) return "unknown";
  const parts = [connection.type, connection.effectiveType].filter(Boolean);
  return parts.length ? parts.join("/") : "unknown";
}

/** webview-level load errors mirrored into the page by the android shell */
function netErrors(): string[] {
  if (typeof window === "undefined") return [];
  const list = (window as unknown as {
    __cloudmusicNetErrors?: Array<{ url?: string; code?: number; detail?: string; status?: number; main?: boolean }>;
  }).__cloudmusicNetErrors;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.slice(-4).map((entry) => {
    const where = entry.main ? "page" : "frame";
    const status = entry.status ? ` http ${entry.status}` : "";
    const code = entry.code ? ` net ${entry.code}` : "";
    return `${where}: ${entry.detail ?? ""}${status}${code} ${entry.url ?? ""}`.trim();
  });
}

export function getAuthTrace(): AuthTraceEntry[] {
  return entries;
}

export function subscribeAuthTrace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** one string per line, safe to copy or screenshot */
export function formatAuthTrace(apiBaseUrl?: string): string {
  const header = apiBaseUrl ? `api: ${apiBaseUrl}` : null;
  const lines = entries.map((entry) => {
    const time = new Date(entry.at).toLocaleTimeString();
    return `${time} ${entry.step}${entry.detail ? `: ${entry.detail}` : ""}`;
  });
  const net = netErrors().map((line) => `net ${line}`);
  return [header, ...lines, ...net].filter(Boolean).join("\n");
}

/** compact suffix for error messages, e.g. "403 CLOUDFLARE_BLOCKED" */
export function describeAuthError(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  const parts: string[] = [];
  if (typeof status === "number" && status > 0) parts.push(String(status));
  if (typeof code === "string" && code) parts.push(code);
  return parts.length ? parts.join(" ") : undefined;
}
