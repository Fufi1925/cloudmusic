import { getApiBaseUrl } from "./baseUrl";

// The api hosts the turnstile widget itself (it needs its own site key and must
// be able to read the clearance cookie). We only embed `/v1/auth/verify` and
// wait for the page to post the token back.
export type HumanCheckAction = "login" | "register";
export type HumanCheckMode = "off" | "optional" | "required";

export interface HumanCheckRequest {
  action: HumanCheckAction;
  mode: Exclude<HumanCheckMode, "off">;
  siteKey?: string;
}

/** why the widget ended without a token (kept for the user-facing message) */
export type HumanCheckFailure = "cancelled" | "timeout" | "error" | "expired" | "blocked";

export interface HumanCheckAnswer {
  token: string | null;
  failure?: HumanCheckFailure;
}

export type HumanCheckPrompt = (
  request: HumanCheckRequest,
) => Promise<string | null | HumanCheckAnswer>;

export class HumanCheckCancelledError extends Error {
  constructor() {
    super("The human check was closed.");
    this.name = "HumanCheckCancelledError";
  }
}

/**
 * The widget never produced a token (did not load, failed, or timed out). This is
 * deliberately *not* retried automatically by the api client: an endless
 * challenge/retry cycle is exactly what the panel must not do.
 */
export class HumanCheckFailedError extends Error {
  readonly reason: HumanCheckFailure;

  constructor(reason: HumanCheckFailure) {
    super(`The human check failed (${reason}).`);
    this.name = "HumanCheckFailedError";
    this.reason = reason;
  }
}

let prompt: HumanCheckPrompt | null = null;

export function setHumanCheckPrompt(next: HumanCheckPrompt | null): void {
  prompt = next;
}

export function humanCheckPageUrl(action: HumanCheckAction): string {
  return `${getApiBaseUrl()}/v1/auth/verify?action=${action}`;
}

export function humanCheckOrigin(): string {
  try {
    return new URL(getApiBaseUrl()).origin;
  } catch {
    return "";
  }
}

export function isHumanCheckMode(value: unknown): value is HumanCheckMode {
  return value === "off" || value === "optional" || value === "required";
}

export async function runHumanCheck(
  action: HumanCheckAction,
  mode: HumanCheckMode,
  siteKey?: string,
): Promise<string | undefined> {
  if (mode === "off") return undefined;
  const answer = prompt ? await prompt({ action, mode, siteKey }) : null;
  const token =
    typeof answer === "string" ? answer : answer && answer.token ? answer.token : null;
  const failure = typeof answer === "string" || !answer ? undefined : answer.failure;
  if (token) return token;
  if (failure === "timeout" || failure === "error" || failure === "expired" || failure === "blocked") {
    // optional mode stays forgiving: the request simply goes out without a token
    if (mode === "required") throw new HumanCheckFailedError(failure);
    return undefined;
  }
  if (mode === "required") throw new HumanCheckCancelledError();
  return undefined;
}
