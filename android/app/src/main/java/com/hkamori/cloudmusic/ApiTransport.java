package com.hkamori.cloudmusic;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Runs api requests through a hidden WebView instead of OkHttp.
 *
 * Why: the api sits behind cloudflare bot management. OkHttp's tls/http
 * fingerprint (boringssl as bundled by okhttp, forced http/1.1, no client hints)
 * is nothing like the webview's chromium, so `POST /v1/auth/challenge` answered
 * 403 on android while the same request worked on desktop - the app never even
 * got as far as the turnstile widget.
 *
 * The hidden page is a tiny document whose base url is the api origin, so its
 * fetch() calls are same-origin: no cors preflight, cookies from the webview jar
 * (including the clearance cookie the verify page sets), chromium's own tls and
 * header stack, exactly like a browser tab on api.tryliner.fun running the same
 * call. Results come back over a javascript interface and are bridged into the
 * renderer's request tunnel.
 */
public final class ApiTransport {
    private static final String TAG = "CloudMusicApi";
    private static final long PAGE_READY_TIMEOUT_MS = 12_000L;

    public static final class Result {
        public int status;
        public String statusText = "";
        public String url = "";
        public final Map<String, String> headers = new LinkedHashMap<>();
        public byte[] body = new byte[0];
        public String error;
    }

    private static final class Pending {
        final CountDownLatch latch = new CountDownLatch(1);
        Result result;
    }

    private final MainActivity activity;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private volatile WebView view;
    private volatile String pageOrigin;
    private volatile boolean ready;
    private volatile CountDownLatch readyLatch = new CountDownLatch(1);
    private volatile boolean closed;

    public ApiTransport(MainActivity activity) {
        this.activity = activity;
    }

    /** True while the hidden page can serve requests for this origin. */
    boolean supports(String origin) {
        return !closed && origin != null && !origin.isEmpty();
    }

    /**
     * Performs one request and blocks until the hidden page answers (it is called
     * from the webview's request thread, never from the ui thread).
     */
    public Result fetch(
            String url,
            String origin,
            String method,
            List<String[]> headers,
            byte[] body,
            boolean withCredentials,
            long timeoutMs) {
        Result result = new Result();
        if (closed) {
            result.error = "transport closed";
            return result;
        }
        if (!ensurePage(origin, timeoutMs)) {
            result.error = "api page not ready";
            return result;
        }
        WebView page = view;
        if (page == null) {
            result.error = "api page gone";
            return result;
        }

        String id = Long.toString(System.nanoTime(), 36) + "-" + Integer.toHexString((int) (Math.random() * 0x7fffffff));
        Pending entry = new Pending();
        pending.put(id, entry);

        JSONArray headerList = new JSONArray();
        if (headers != null) {
            for (String[] pair : headers) {
                if (pair == null || pair.length < 2 || pair[0] == null) continue;
                JSONArray item = new JSONArray();
                item.put(pair[0]);
                item.put(pair[1] == null ? "" : pair[1]);
                headerList.put(item);
            }
        }
        String bodyB64 = body == null ? null : Base64.getEncoder().encodeToString(body);
        String script =
                "window.__cloudMusicApiFetch&&window.__cloudMusicApiFetch("
                        + JSONObject.quote(id) + ","
                        + JSONObject.quote(url) + ","
                        + JSONObject.quote(method == null ? "GET" : method.toUpperCase(Locale.ROOT)) + ","
                        + JSONObject.quote(headerList.toString()) + ","
                        + (bodyB64 == null ? "null" : JSONObject.quote(bodyB64)) + ","
                        + JSONObject.quote(withCredentials ? "include" : "same-origin")
                        + ")";
        ui.post(() -> {
            WebView target = view;
            if (target == null) {
                Pending waiting = pending.remove(id);
                if (waiting != null) {
                    Result failed = new Result();
                    failed.error = "api page gone";
                    waiting.result = failed;
                    waiting.latch.countDown();
                }
                return;
            }
            target.evaluateJavascript(script, null);
        });

        try {
            if (!entry.latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                pending.remove(id);
                result.error = "api request timed out";
                return result;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            pending.remove(id);
            result.error = "api request interrupted";
            return result;
        }
        pending.remove(id);
        return entry.result == null ? result : entry.result;
    }

    // ------------------------------------------------------------------ page

    private boolean ensurePage(String origin, long timeoutMs) {
        if (view != null && ready && origin.equals(pageOrigin)) return true;
        CountDownLatch latch;
        synchronized (this) {
            if (closed) return false;
            if (view == null || !origin.equals(pageOrigin)) {
                ready = false;
                readyLatch = new CountDownLatch(1);
                pageOrigin = origin;
                ui.post(() -> loadPage(origin));
            }
            latch = readyLatch;
        }
        try {
            return latch.await(Math.min(PAGE_READY_TIMEOUT_MS, Math.max(2_000L, timeoutMs)),
                    TimeUnit.MILLISECONDS) && ready;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void loadPage(String origin) {
        if (closed) return;
        destroyView();
        WebView page = new WebView(activity);
        WebSettings settings = page.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(UserAgent.get(activity));
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        page.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                // the helper document itself never leaves the device: it is served here
                // so the page has a real https://api.../ origin (a data: url would be
                // an opaque origin and the fetch calls would be cross-origin again)
                if (isHelperUrl(request.getUrl())) return helperDocument();
                return null;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (v == page && request.isForMainFrame()) {
                    Log.w(TAG, "api page failed: " + error.getDescription());
                    markNotReady();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                // the helper document never navigates
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                if (v == page) ui.post(() -> markNotReady());
                return true;
            }
        });
        page.addJavascriptInterface(new Bridge(page), "CloudMusicApi");
        view = page;
        activity.attachHiddenView(page);
        page.loadUrl(origin + HELPER_PATH);
    }

    private static final String HELPER_PATH = "/__cloudmusic_api_helper__";

    private boolean isHelperUrl(Uri url) {
        if (url == null || pageOrigin == null) return false;
        String text = url.toString();
        return text.startsWith(pageOrigin + HELPER_PATH);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebResourceResponse helperDocument() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", pageOrigin == null ? "*" : pageOrigin);
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(PAGE.getBytes(StandardCharsets.UTF_8)));
    }

    private void markNotReady() {
        ready = false;
        CountDownLatch latch = readyLatch;
        if (latch != null) latch.countDown();
    }

    private void markReady(WebView source) {
        if (source != view) return;
        ready = true;
        CountDownLatch latch = readyLatch;
        if (latch != null) latch.countDown();
    }

    private void settle(WebView source, String id, String payload, String error) {
        if (source != view || id == null) return;
        Pending entry = pending.get(id);
        if (entry == null) return;
        Result result = new Result();
        if (error != null) {
            result.error = error;
        } else {
            try {
                JSONObject data = new JSONObject(payload);
                result.status = data.optInt("status", 0);
                result.statusText = data.optString("statusText", "");
                result.url = data.optString("url", "");
                JSONArray list = data.optJSONArray("headers");
                if (list != null) {
                    for (int i = 0; i < list.length(); i++) {
                        JSONArray pair = list.optJSONArray(i);
                        if (pair == null || pair.length() < 2) continue;
                        result.headers.put(pair.optString(0), pair.optString(1));
                    }
                }
                String bodyB64 = data.optString("body", "");
                result.body = bodyB64.isEmpty() ? new byte[0] : Base64.getDecoder().decode(bodyB64);
            } catch (Exception e) {
                result.error = "bad api response: " + e.getMessage();
            }
        }
        entry.result = result;
        entry.latch.countDown();
    }

    public void destroy() {
        closed = true;
        pending.clear();
        ui.post(this::destroyView);
    }

    private void destroyView() {
        WebView old = view;
        view = null;
        ready = false;
        if (old != null) {
            activity.detachHiddenView(old);
            old.destroy();
        }
    }

    private final class Bridge {
        private final WebView source;

        Bridge(WebView source) {
            this.source = source;
        }

        @JavascriptInterface
        public void ready(String origin) {
            if (pageOrigin != null && origin != null && !pageOrigin.equals(origin)) {
                Log.w(TAG, "api page origin mismatch: " + origin + " != " + pageOrigin);
            }
            markReady(source);
        }

        @JavascriptInterface
        public void resolve(String id, String payload) {
            settle(source, id, payload, null);
        }

        @JavascriptInterface
        public void reject(String id, String message) {
            settle(source, id, null, message == null ? "api request failed" : message);
        }
    }

    private static final String PAGE =
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>api</title></head><body>"
                    + "<script>\n"
                    + "(function(){\n"
                    + "  function b64ToBytes(text){\n"
                    + "    var bin = atob(text), out = new Uint8Array(bin.length);\n"
                    + "    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);\n"
                    + "    return out;\n"
                    + "  }\n"
                    + "  function bytesToB64(buffer){\n"
                    + "    var bytes = new Uint8Array(buffer), binary = '', chunk = 0x8000;\n"
                    + "    for (var i = 0; i < bytes.length; i += chunk) {\n"
                    + "      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));\n"
                    + "    }\n"
                    + "    return btoa(binary);\n"
                    + "  }\n"
                    + "  window.__cloudMusicApiFetch = function(id, url, method, headersJson, bodyB64, credentials){\n"
                    + "    var bridge = window.CloudMusicApi;\n"
                    + "    var headers = {};\n"
                    + "    try {\n"
                    + "      JSON.parse(headersJson || '[]').forEach(function(pair){ if (pair && pair[0]) headers[pair[0]] = pair[1]; });\n"
                    + "    } catch (e) {}\n"
                    + "    var init = { method: method, headers: headers, credentials: credentials || 'same-origin', redirect: 'follow', cache: 'no-store' };\n"
                    + "    if (bodyB64) init.body = b64ToBytes(bodyB64);\n"
                    + "    fetch(url, init).then(function(response){\n"
                    + "      return response.arrayBuffer().then(function(buffer){\n"
                    + "        var list = [];\n"
                    + "        response.headers.forEach(function(value, name){ list.push([name, value]); });\n"
                    + "        bridge.resolve(id, JSON.stringify({\n"
                    + "          status: response.status,\n"
                    + "          statusText: response.statusText,\n"
                    + "          url: response.url,\n"
                    + "          headers: list,\n"
                    + "          body: bytesToB64(buffer)\n"
                    + "        }));\n"
                    + "      });\n"
                    + "    }).catch(function(error){\n"
                    + "      bridge.reject(id, String(error && error.message ? error.message : error));\n"
                    + "    });\n"
                    + "  };\n"
                    + "  window.CloudMusicApi.ready(location.origin);\n"
                    + "})();\n"
                    + "</script></body></html>";
}
