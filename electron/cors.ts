const CORS_HEADERS = new Set([
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-credentials",
  "access-control-expose-headers",
  "access-control-max-age",
]);

const PREFLIGHT_STATUS_LINE = "HTTP/1.1 200 OK";

// hosts the renderer calls cross-origin (fetch, <audio crossorigin>, cors images
// for the webgl/canvas cover effects). each entry also matches its subdomains.
const OPEN_CORS_DOMAINS = [
  // liner api, covers proxy, telemetry
  "tryliner.fun",
  // innertube, tv oauth, player js, audio streams, thumbnails and avatars
  "youtube.com",
  "googlevideo.com",
  "ytimg.com",
  "ggpht.com",
  "googleusercontent.com",
  // soundcloud api, client id scrape, progressive and hls streams, artwork
  "soundcloud.com",
  "sndcdn.com",
  "soundcloud.cloud",
  // spotify import: token, pathfinder, web player js, short links, covers
  "spotify.com",
  "spotifycdn.com",
  "spotify.link",
  "scdn.co",
  // deezer and apple music import, covers
  "deezer.com",
  "dzcdn.net",
  "music.apple.com",
  "mzstatic.com",
  // artist avatars
  "genius.com",
  // presigned audio urls
  "r2.cloudflarestorage.com",
  // google fonts from index.html
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function needsOpenCors(url: string, allowLoopback = false): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (allowLoopback && LOOPBACK_HOSTS.has(host)) return true;
  return OPEN_CORS_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * The api answers credentialed requests (auth edge cookie) with its own exact
 * CORS headers. Those must be left untouched: a wildcard origin is illegal
 * together with credentials and would break sign-in.
 */
export function keepsOwnCors(url: string, allowLoopback = false): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (allowLoopback && LOOPBACK_HOSTS.has(host)) return true;
  return host === "tryliner.fun" || host.endsWith(".tryliner.fun");
}

export type ResponseHeaders = Record<string, string[]>;

export interface CorsResponse {
  responseHeaders: ResponseHeaders;
  statusLine?: string;
}

function allowsCredentials(headers: ResponseHeaders | undefined): boolean {
  return Object.entries(headers ?? {}).some(
    ([name, value]) =>
      name.toLowerCase() === "access-control-allow-credentials" &&
      value.some((entry) => entry.trim().toLowerCase() === "true"),
  );
}

export function withOpenCors(
  headers: ResponseHeaders | undefined,
  method: string,
  ownCors = false,
): CorsResponse {
  if (ownCors && headers && allowsCredentials(headers)) {
    return {
      responseHeaders: headers,
      // a credentialed preflight still needs a successful status
      ...(method.toUpperCase() === "OPTIONS" ? { statusLine: PREFLIGHT_STATUS_LINE } : {}),
    };
  }
  const responseHeaders: ResponseHeaders = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!CORS_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
  }
  responseHeaders["access-control-allow-origin"] = ["*"];
  responseHeaders["access-control-allow-headers"] = ["*, authorization"];
  responseHeaders["access-control-allow-methods"] = [
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  ];
  responseHeaders["access-control-expose-headers"] = ["*"];
  responseHeaders["access-control-max-age"] = ["600"];
  return method.toUpperCase() === "OPTIONS"
    ? { responseHeaders, statusLine: PREFLIGHT_STATUS_LINE }
    : { responseHeaders };
}
