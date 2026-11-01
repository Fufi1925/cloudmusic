// Keeps a short, human-readable trace of the last sign-in attempt.
//
// The auth flow talks to a server we do not control and embeds a third-party
// verification page, so when something fails the app has to be able to say
// *what* failed (status, code, which step) instead of "something went wrong".
// The trace is meant to be readable in a screenshot.
export type AuthTraceEntry = { at: number; step: string; detail?: string };

const MAX_ENTRIES = 14;
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
  notify();
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
  return [header, ...lines].filter(Boolean).join("\n");
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
