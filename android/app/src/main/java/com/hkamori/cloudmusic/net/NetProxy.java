package com.hkamori.cloudmusic.net;

import android.content.Context;
import android.os.LocaleList;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Cache;
import okhttp3.CacheControl;
import okhttp3.Call;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Native network layer standing in for electron's {@code webSecurity: false}
 * plus the {@code webRequest} hooks in electron/main.ts.
 *
 * <ul>
 *   <li><b>Tunnel</b> ({@code /__cloudmusic_net__/<id>}): every cross-origin fetch() of the
 *       renderer, parked by cloudmusic-android.js through {@link Js#prepare}. Method, headers
 *       and body are replayed with OkHttp and the response is streamed back same-origin.</li>
 *   <li><b>Subresources</b>: GET/HEAD for images, audio, fonts, css are proxied directly
 *       and get the permissive CORS headers electron's {@code onHeadersReceived} adds,
 *       so WebGL textures, canvas color sampling and Web Audio keep working.</li>
 * </ul>
 */
public final class NetProxy {
    private static final String TAG = "CloudMusicNet";
    public static final String TUNNEL_PATH = "/__cloudmusic_net__/";
    static final String META = "x-cmproxy-";
    private static final long PENDING_TTL_MS = 120_000L;

    private static final Set<String> HOP_BY_HOP = new HashSet<>(Arrays.asList(
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"));

    private static final Set<String> TUNNEL_REQUEST_SKIP = new HashSet<>(Arrays.asList(
            "host", "connection", "content-length", "accept-encoding", "transfer-encoding",
            "te", "trailer", "upgrade", "keep-alive", "proxy-connection", "expect",
            "cookie", "cookie2"));

    private static final Set<String> SUBRESOURCE_REQUEST_SKIP = new HashSet<>(Arrays.asList(
            "host", "connection", "content-length", "accept-encoding", "transfer-encoding",
            "te", "trailer", "upgrade", "keep-alive", "proxy-connection", "expect",
            "cookie", "cookie2", "origin", "referer",
            // intercepted responses cannot be 304, so never ask for one
            "if-none-match", "if-modified-since"));

    private final OkHttpClient client;
    private final OkHttpClient noRedirectClient;
    private final Cache cache;
    private final String userAgent;
    private final String acceptLanguage;
    private final ConcurrentHashMap<String, Pending> pending = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Call> inflight = new ConcurrentHashMap<>();
    private final Js js = new Js();
    private volatile long lastSweep;

    private static final class Pending {
        final long createdAt = SystemClock.elapsedRealtime();
        final JSONObject descriptor;
        final byte[] body;
        volatile boolean canceled;

        Pending(JSONObject descriptor, byte[] body) {
            this.descriptor = descriptor;
            this.body = body;
        }
    }

    public NetProxy(Context context, String userAgent) {
        this.userAgent = userAgent;
        this.acceptLanguage = buildAcceptLanguage();
        // chromium keeps an http cache for the electron renderer; covers and static
        // json are cached the same way here
        this.cache = new Cache(new File(context.getCacheDir(), "cloudmusic-http"), 160L * 1024 * 1024);
        this.client = new OkHttpClient.Builder()
                // electron starts with --disable-http2 ("resilient http/1.1")
                .protocols(Collections.singletonList(Protocol.HTTP_1_1))
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .followRedirects(true)
                .followSslRedirects(true)
                .retryOnConnectionFailure(true)
                .cache(cache)
                .addInterceptor(this::applyDefaults)
                .addNetworkInterceptor(new WebCookies())
                .addNetworkInterceptor(new ElectronHeaders())
                .build();
        this.noRedirectClient = client.newBuilder().followRedirects(false).followSslRedirects(false).build();
    }

    public OkHttpClient client() {
        return client;
    }

    /**
     * Native requests (artwork, BotGuard interpreter) carry the same UA as the WebViews,
     * and audio streams stay out of the http cache: the renderer caches finished tracks
     * in IndexedDB itself, the disk cache is for covers and api json.
     */
    private Response applyDefaults(okhttp3.Interceptor.Chain chain) throws IOException {
        Request request = chain.request();
        Request.Builder builder = null;
        if (request.header("User-Agent") == null) {
            builder = request.newBuilder().header("User-Agent", userAgent);
        }
        if (isMediaHost(request.url().host()) && request.header("Cache-Control") == null) {
            if (builder == null) builder = request.newBuilder();
            builder.cacheControl(new CacheControl.Builder().noStore().build());
        }
        return chain.proceed(builder == null ? request : builder.build());
    }

    static boolean isMediaHost(String host) {
        String h = host.toLowerCase(Locale.ROOT);
        return h.endsWith(".googlevideo.com")
                || h.endsWith(".soundcloud.cloud")
                || (h.endsWith(".sndcdn.com") && h.contains("media"));
    }

    public String userAgent() {
        return userAgent;
    }

    public Object jsInterface() {
        return js;
    }

    public long cacheSize() {
        try {
            return cache.size();
        } catch (IOException e) {
            return 0L;
        }
    }

    public File cacheDirectory() {
        return cache.directory();
    }

    public void clearCache() {
        try {
            cache.evictAll();
        } catch (IOException e) {
            Log.w(TAG, "cache evict failed", e);
        }
    }

    /** JavaScript interface "CloudMusicNet" (called on the WebView's JavaBridge thread). */
    public final class Js {
        @JavascriptInterface
        public void prepare(String id, String descriptorJson, String bodyBase64) {
            if (id == null || descriptorJson == null) return;
            try {
                byte[] body = bodyBase64 == null || bodyBase64.isEmpty()
                        ? null
                        : Base64.decode(bodyBase64, Base64.DEFAULT);
                pending.put(id, new Pending(new JSONObject(descriptorJson), body));
            } catch (Exception e) {
                Log.w(TAG, "invalid tunnel descriptor", e);
            }
            sweep();
        }

        @JavascriptInterface
        public void cancel(String id) {
            if (id == null) return;
            Pending parked = pending.remove(id);
            if (parked != null) parked.canceled = true;
            Call call = inflight.remove(id);
            if (call != null) call.cancel();
        }
    }

    private void sweep() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastSweep < 30_000L) return;
        lastSweep = now;
        Iterator<Map.Entry<String, Pending>> it = pending.entrySet().iterator();
        while (it.hasNext()) {
            if (now - it.next().getValue().createdAt > PENDING_TTL_MS) it.remove();
        }
    }

    // ---------------------------------------------------------------- tunnel

    public WebResourceResponse handleTunnel(String id) {
        Pending parked = id == null ? null : pending.remove(id);
        if (parked == null) return errorResponse("unknown request");
        if (parked.canceled) return errorResponse("aborted");

        Request request;
        String redirectMode;
        try {
            redirectMode = parked.descriptor.optString("redirect", "follow");
            request = buildTunnelRequest(parked);
        } catch (Exception e) {
            return errorResponse("invalid request: " + e.getMessage());
        }

        Call call = ("follow".equals(redirectMode) ? client : noRedirectClient).newCall(request);
        inflight.put(id, call);
        Response response;
        try {
            response = call.execute();
        } catch (IOException e) {
            inflight.remove(id);
            return errorResponse(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
        if ("error".equals(redirectMode) && response.isRedirect()) {
            response.close();
            inflight.remove(id);
            return errorResponse("redirect in error mode");
        }
        return tunnelResponse(id, response);
    }

    private Request buildTunnelRequest(Pending parked) throws Exception {
        JSONObject d = parked.descriptor;
        String url = d.getString("url");
        String method = d.optString("method", "GET").toUpperCase(Locale.ROOT);
        String mode = d.optString("mode", "cors");
        String credentials = d.optString("credentials", "same-origin");
        String cacheMode = d.optString("cache", "default");

        Headers.Builder headers = new Headers.Builder();
        String contentType = null;
        boolean hasAccept = false;
        boolean hasLanguage = false;
        boolean hasUserAgent = false;
        JSONArray list = d.optJSONArray("headers");
        if (list != null) {
            for (int i = 0; i < list.length(); i++) {
                JSONArray pair = list.optJSONArray(i);
                if (pair == null || pair.length() < 2) continue;
                String name = pair.optString(0, "");
                String value = pair.optString(1, "");
                String lower = name.toLowerCase(Locale.ROOT);
                if (name.isEmpty() || TUNNEL_REQUEST_SKIP.contains(lower)) continue;
                if (lower.equals("content-type")) contentType = value;
                if (lower.equals("accept")) hasAccept = true;
                if (lower.equals("accept-language")) hasLanguage = true;
                if (lower.equals("user-agent")) hasUserAgent = true;
                try {
                    headers.addUnsafeNonAscii(name, value);
                } catch (IllegalArgumentException ignored) {
                    // chromium would have rejected that header name as well
                }
            }
        }
        if (!hasUserAgent) headers.set("User-Agent", userAgent);
        if (!hasAccept) headers.set("Accept", "*/*");
        if (!hasLanguage) headers.set("Accept-Language", acceptLanguage);
        boolean simpleMethod = method.equals("GET") || method.equals("HEAD");
        // what chromium attaches to cors-mode / non-GET requests issued from
        // electron's file:// renderer (ElectronHeaders rewrites it per host)
        if ("cors".equals(mode) || !simpleMethod) headers.set("Origin", "file://");

        RequestBody body = null;
        if (permitsRequestBody(method)) {
            MediaType mediaType = contentType == null ? null : MediaType.parse(contentType);
            if (parked.body != null) {
                body = RequestBody.create(parked.body, mediaType);
            } else if (requiresRequestBody(method)) {
                body = RequestBody.create(new byte[0], mediaType);
            }
        }

        Request.Builder builder = new Request.Builder()
                .url(url)
                .headers(headers.build())
                .method(method, body)
                .tag(ProxyTag.class, "include".equals(credentials) ? ProxyTag.WITH_CREDENTIALS : ProxyTag.ANONYMOUS);

        switch (cacheMode) {
            case "no-store":
                builder.cacheControl(new CacheControl.Builder().noCache().noStore().build());
                break;
            case "reload":
            case "no-cache":
                builder.cacheControl(CacheControl.FORCE_NETWORK);
                break;
            case "force-cache":
                builder.cacheControl(new CacheControl.Builder().maxStale(Integer.MAX_VALUE, TimeUnit.SECONDS).build());
                break;
            case "only-if-cached":
                builder.cacheControl(CacheControl.FORCE_CACHE);
                break;
            default:
                break;
        }
        return builder.build();
    }

    private WebResourceResponse tunnelResponse(String id, Response response) {
        int code = response.code();
        Map<String, String> headers = new LinkedHashMap<>();
        copyHeaders(response.headers(), headers, false);
        if (hasNoBody(response)) headers.remove("content-length");
        String rawContentType = response.header("Content-Type");
        headers.put(META + "status", String.valueOf(code));
        headers.put(META + "status-text", HttpText.percentEncode(response.message()));
        headers.put(META + "url", response.request().url().toString());
        headers.put(META + "redirected", response.priorResponse() != null ? "1" : "0");
        if (rawContentType != null) headers.put(META + "content-type", HttpText.sanitize(rawContentType));

        int webStatus = HttpText.isAllowedWebStatus(code) ? code : 200;
        String[] media = HttpText.mediaType(rawContentType, "application/octet-stream");
        return new WebResourceResponse(media[0], media[1], webStatus,
                HttpText.reason(webStatus, webStatus == code ? response.message() : null),
                headers, new BodyStream(response, () -> inflight.remove(id)));
    }

    // ----------------------------------------------------------- subresources

    public WebResourceResponse handleSubresource(WebResourceRequest request) {
        String method = request.getMethod() == null ? "GET" : request.getMethod().toUpperCase(Locale.ROOT);
        Map<String, String> incoming = request.getRequestHeaders();
        String requestOrigin = header(incoming, "Origin");

        if (method.equals("OPTIONS")) return preflightResponse(requestOrigin, header(incoming, "Access-Control-Request-Headers"));
        // request bodies are not visible to shouldInterceptRequest; fetch() bodies go
        // through the tunnel, anything else is left to the WebView
        if (!method.equals("GET") && !method.equals("HEAD")) return null;

        Headers.Builder headers = new Headers.Builder();
        boolean hasUserAgent = false;
        boolean hasLanguage = false;
        if (incoming != null) {
            for (Map.Entry<String, String> entry : incoming.entrySet()) {
                String name = entry.getKey();
                if (name == null) continue;
                String lower = name.toLowerCase(Locale.ROOT);
                if (SUBRESOURCE_REQUEST_SKIP.contains(lower)) continue;
                if (lower.equals("user-agent")) hasUserAgent = true;
                if (lower.equals("accept-language")) hasLanguage = true;
                try {
                    headers.addUnsafeNonAscii(name, entry.getValue() == null ? "" : entry.getValue());
                } catch (IllegalArgumentException ignored) {
                    // skip malformed header
                }
            }
        }
        if (!hasUserAgent) headers.set("User-Agent", userAgent);
        if (!hasLanguage) headers.set("Accept-Language", acceptLanguage);
        if (requestOrigin != null) headers.set("Origin", "file://");

        Request upstream;
        try {
            upstream = new Request.Builder()
                    .url(request.getUrl().toString())
                    .headers(headers.build())
                    .method(method, null)
                    .tag(ProxyTag.class, ProxyTag.ANONYMOUS)
                    .build();
        } catch (IllegalArgumentException e) {
            return null;
        }

        Response response;
        try {
            response = client.newCall(upstream).execute();
        } catch (IOException e) {
            Map<String, String> h = new LinkedHashMap<>();
            addCors(h, requestOrigin);
            return new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", h,
                    new ByteArrayInputStream(new byte[0]));
        }

        int code = response.code();
        Map<String, String> out = new LinkedHashMap<>();
        copyHeaders(response.headers(), out, true);
        if (hasNoBody(response)) out.remove("content-length");
        addCors(out, requestOrigin);
        String[] media = HttpText.mediaType(response.header("Content-Type"), guessMime(upstream.url().encodedPath()));
        if (!HttpText.isAllowedWebStatus(code)) {
            response.close();
            return new WebResourceResponse(media[0], media[1], 502, "Bad Gateway", out,
                    new ByteArrayInputStream(new byte[0]));
        }
        return new WebResourceResponse(media[0], media[1], code, HttpText.reason(code, response.message()),
                out, new BodyStream(response, null));
    }

    // electron: onHeadersReceived -> access-control-allow-* on every response
    private static void addCors(Map<String, String> headers, String requestOrigin) {
        if (requestOrigin != null && !requestOrigin.isEmpty() && !"null".equals(requestOrigin)) {
            headers.put("Access-Control-Allow-Origin", requestOrigin);
            headers.put("Access-Control-Allow-Credentials", "true");
        } else {
            headers.put("Access-Control-Allow-Origin", "*");
        }
        headers.put("Access-Control-Allow-Headers", "*");
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.put("Access-Control-Expose-Headers", "*");
    }

    private static WebResourceResponse preflightResponse(String requestOrigin, String requestHeaders) {
        Map<String, String> headers = new LinkedHashMap<>();
        addCors(headers, requestOrigin);
        if (requestHeaders != null && !requestHeaders.isEmpty()) {
            headers.put("Access-Control-Allow-Headers", HttpText.sanitize(requestHeaders));
        }
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
        headers.put("Access-Control-Max-Age", "600");
        return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    // ---------------------------------------------------------------- helpers

    private static void copyHeaders(Headers source, Map<String, String> target, boolean dropCors) {
        for (String name : source.names()) {
            String lower = name.toLowerCase(Locale.ROOT);
            if (HOP_BY_HOP.contains(lower)) continue;
            if (lower.equals("set-cookie") || lower.equals("set-cookie2")) continue;
            if (lower.equals("content-type")) continue; // passed as WebResourceResponse mime/charset
            if (dropCors && lower.startsWith("access-control-")) continue;
            String joined = String.join(", ", source.values(name));
            target.put(lower, HttpText.sanitize(joined));
        }
    }

    private static boolean hasNoBody(Response response) {
        int code = response.code();
        return "HEAD".equals(response.request().method()) || code == 204 || code == 205 || code == 304
                || (code >= 100 && code < 200);
    }

    private static boolean permitsRequestBody(String method) {
        return !(method.equals("GET") || method.equals("HEAD"));
    }

    private static boolean requiresRequestBody(String method) {
        return method.equals("POST") || method.equals("PUT") || method.equals("PATCH")
                || method.equals("PROPPATCH") || method.equals("REPORT");
    }

    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return null;
    }

    static WebResourceResponse errorResponse(String message) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put(META + "error", HttpText.sanitize(message == null ? "error" : message));
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    private static String guessMime(String path) {
        String p = path == null ? "" : path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".m4a") || p.endsWith(".mp4")) return "audio/mp4";
        if (p.endsWith(".webm")) return "audio/webm";
        return "application/octet-stream";
    }

    private static String buildAcceptLanguage() {
        StringBuilder out = new StringBuilder();
        Set<String> seen = new HashSet<>();
        float q = 1.0f;
        LocaleList locales = LocaleList.getDefault();
        for (int i = 0; i < locales.size() && seen.size() < 6; i++) {
            Locale locale = locales.get(i);
            String tag = locale.toLanguageTag();
            String lang = locale.getLanguage();
            for (String candidate : new String[] {tag, lang}) {
                if (candidate == null || candidate.isEmpty() || candidate.equals("und") || !seen.add(candidate)) continue;
                if (out.length() > 0) out.append(',');
                out.append(candidate);
                if (q < 1.0f) out.append(String.format(Locale.ROOT, ";q=%.1f", q));
                q = Math.max(0.1f, q - 0.1f);
            }
        }
        if (!seen.contains("en")) {
            if (out.length() > 0) out.append(',');
            out.append("en-US").append(String.format(Locale.ROOT, ";q=%.1f", Math.max(0.1f, q)))
                    .append(",en").append(String.format(Locale.ROOT, ";q=%.1f", Math.max(0.1f, q - 0.1f)));
        }
        return out.length() == 0 ? "en-US,en;q=0.9" : out.toString();
    }

    /** Streams an OkHttp body into the WebView and releases the connection when it is done. */
    private static final class BodyStream extends FilterInputStream {
        private final Response response;
        private final Runnable onClose;
        private boolean closed;

        BodyStream(Response response, Runnable onClose) {
            super(openBody(response));
            this.response = response;
            this.onClose = onClose;
        }

        private static InputStream openBody(Response response) {
            ResponseBody body = response.body();
            return body == null ? new ByteArrayInputStream(new byte[0]) : body.byteStream();
        }

        @Override
        public void close() throws IOException {
            if (closed) return;
            closed = true;
            try {
                super.close();
            } finally {
                response.close();
                if (onClose != null) onClose.run();
            }
        }
    }
}
