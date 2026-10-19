// Network layer replacement for electron's `webSecurity: false` + webRequest hooks.
//
// Electron disables CORS for the whole renderer and rewrites Origin / Referer /
// User-Agent for youtube, googlevideo and apple music in the main process. An
// android WebView always enforces CORS and never lets page JS set those headers,
// so every cross-origin fetch() is tunnelled through the native layer:
//
//   1. the request (method, headers, body) is parked natively via LinerNet.prepare()
//   2. the page fetches the same-origin url /__liner_net__/<id>
//   3. WebViewClient.shouldInterceptRequest() performs the real request with OkHttp
//      (same header rewriting rules as electron/main.ts) and streams the response back
//
// Being same-origin, the tunnel has no CORS preflight, every response header is
// readable (the api client reads `date` for clock sync) and bodies stream.
// <img>, <audio>, fonts and css never hit fetch(); the native side proxies those
// GET requests directly and adds the permissive CORS headers electron adds.

interface NativeNet {
  prepare(id: string, descriptorJson: string, bodyBase64: string | null): void;
  cancel(id: string): void;
}

declare global {
  interface Window {
    LinerNet?: NativeNet;
  }
}

export const PROXY_PATH = "/__liner_net__/";
const META = "x-lnrproxy-";
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

let seq = 0;

function nextId(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The user aborted a request.", "AbortError");
}

function decorate(response: Response, url: string, redirected: boolean): Response {
  const clone = response.clone.bind(response);
  Object.defineProperties(response, {
    url: { value: url, configurable: true },
    redirected: { value: redirected, configurable: true },
    type: { value: "cors", configurable: true },
    clone: { value: () => decorate(clone(), url, redirected), configurable: true },
  });
  return response;
}

export function installFetchProxy(): void {
  const net = window.LinerNet;
  if (!net || (window.fetch as any).__linerProxied) return;

  const nativeFetch = window.fetch.bind(window);
  const appOrigin = window.location.origin;

  const proxiedFetch = async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      // invalid input: let chromium produce the exact same TypeError it would
      return nativeFetch(input as RequestInfo, init);
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return nativeFetch(input as RequestInfo, init);
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin === appOrigin) {
      return nativeFetch(input as RequestInfo, init);
    }

    const signal = request.signal;
    if (signal.aborted) throw abortError(signal);

    const method = request.method.toUpperCase();
    let bodyBase64: string | null = null;
    if (method !== "GET" && method !== "HEAD" && request.body !== null) {
      bodyBase64 = toBase64(await request.arrayBuffer());
      if (signal.aborted) throw abortError(signal);
    }

    const headers: Array<[string, string]> = [];
    request.headers.forEach((value, name) => headers.push([name, value]));

    const id = nextId();
    net.prepare(
      id,
      JSON.stringify({
        url: url.href,
        method,
        headers,
        mode: request.mode,
        credentials: request.credentials,
        redirect: request.redirect,
        cache: request.cache,
      }),
      bodyBase64,
    );

    const cancel = () => {
      try {
        net.cancel(id);
      } catch {
        // bridge gone (page unloading)
      }
    };
    signal.addEventListener("abort", cancel, { once: true });

    let tunnel: Response;
    try {
      tunnel = await nativeFetch(PROXY_PATH + id, { signal, cache: "no-store", credentials: "omit" });
    } catch (error) {
      signal.removeEventListener("abort", cancel);
      cancel();
      throw error;
    }

    if (tunnel.headers.get(`${META}error`) !== null) {
      signal.removeEventListener("abort", cancel);
      await tunnel.body?.cancel().catch(() => undefined);
      // same wording chromium uses for network level failures
      throw new TypeError("Failed to fetch");
    }

    const status = Number(tunnel.headers.get(`${META}status`)) || tunnel.status;
    let statusText = tunnel.statusText;
    const rawStatusText = tunnel.headers.get(`${META}status-text`);
    if (rawStatusText !== null) {
      try {
        statusText = decodeURIComponent(rawStatusText);
      } catch {
        statusText = rawStatusText;
      }
    }
    const finalUrl = tunnel.headers.get(`${META}url`) || url.href;
    const redirected = tunnel.headers.get(`${META}redirected`) === "1";
    const contentType = tunnel.headers.get(`${META}content-type`);

    const outHeaders = new Headers();
    tunnel.headers.forEach((value, name) => {
      if (name.startsWith(META) || name === "content-type") return;
      try {
        outHeaders.append(name, value);
      } catch {
        // header chromium would not expose anyway
      }
    });
    if (contentType) outHeaders.set("content-type", contentType);

    const nullBody = method === "HEAD" || NULL_BODY_STATUS.has(status);
    const body = nullBody ? null : tunnel.body;
    let response: Response;
    try {
      response = new Response(body, { status, statusText, headers: outHeaders });
    } catch {
      response = new Response(body, { status: status >= 200 && status <= 599 ? status : 502, headers: outHeaders });
    }
    return decorate(response, finalUrl, redirected);
  };

  Object.defineProperty(proxiedFetch, "__linerProxied", { value: true });
  window.fetch = proxiedFetch as typeof window.fetch;
}
