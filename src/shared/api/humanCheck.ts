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

export type HumanCheckPrompt = (
  request: HumanCheckRequest,
) => Promise<string | null>;

export class HumanCheckCancelledError extends Error {
  constructor() {
    super("The human check was closed.");
    this.name = "HumanCheckCancelledError";
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
  const token = prompt ? await prompt({ action, mode, siteKey }) : null;
  if (token) return token;
  if (mode === "required") throw new HumanCheckCancelledError();
  return undefined;
}
