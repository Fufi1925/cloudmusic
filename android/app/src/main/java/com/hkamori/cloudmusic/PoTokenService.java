package com.hkamori.cloudmusic;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Port of electron/potoken.ts: BotGuard runs inside a hidden WebView sitting on
 * https://www.youtube.com/robots.txt (a genuine youtube.com origin, same page as
 * the electron hidden window) and mints content-bound PO tokens for WEB_REMIX
 * playback. The worker script is assets/www/potoken-worker.js (port of
 * electron/potoken-preload.ts), the interpreter download stays native like the
 * "potoken:interpreter" ipc handler.
 */
final class PoTokenService {
    private static final String TAG = "CloudMusicPoToken";
    private static final String BOTGUARD_PAGE = "https://www.youtube.com/robots.txt";
    private static final long START_TIMEOUT_MS = 20_000L;
    private static final long MINT_TIMEOUT_MS = 20_000L;
    private static final Pattern IDENTIFIER = Pattern.compile("^[\\w-]{1,128}$");
    private static final Set<String> INTERPRETER_HOSTS = new HashSet<>(Arrays.asList("www.google.com", "www.gstatic.com"));

    interface Callback {
        void onToken(String token);

        void onError(String message);
    }

    private interface ReadyWaiter {
        void onReady();

        void onFailed(String message);
    }

    private static final class PendingMint {
        final Callback callback;
        Runnable timeout;

        PendingMint(Callback callback) {
            this.callback = callback;
        }
    }

    private final MainActivity activity;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<Integer, PendingMint> pending = new HashMap<>();
    private final List<ReadyWaiter> waiters = new ArrayList<>();
    private WebView webView;
    private boolean ready;
    private boolean injected;
    private Runnable startTimeout;
    private int nextId = 1;
    private String workerScript;

    PoTokenService(MainActivity activity) {
        this.activity = activity;
    }

    /** potoken:mint (main thread). */
    void mint(String identifier, Callback callback) {
        if (identifier == null || !IDENTIFIER.matcher(identifier).matches()) {
            callback.onError("invalid identifier");
            return;
        }
        whenReady(new ReadyWaiter() {
            @Override
            public void onReady() {
                if (webView == null) {
                    callback.onError("PO token window is not available");
                    return;
                }
                int id = nextId++;
                PendingMint entry = new PendingMint(callback);
                entry.timeout = () -> {
                    if (pending.remove(id) != null) callback.onError("PO token minting timed out");
                };
                pending.put(id, entry);
                ui.postDelayed(entry.timeout, MINT_TIMEOUT_MS);
                webView.evaluateJavascript("window.__cloudMusicPoWorker&&window.__cloudMusicPoWorker.mint(" + id + ","
                        + JSONObject.quote(identifier) + ")", null);
            }

            @Override
            public void onFailed(String message) {
                callback.onError(message);
            }
        });
    }

    private void whenReady(ReadyWaiter waiter) {
        if (webView != null && ready) {
            waiter.onReady();
            return;
        }
        waiters.add(waiter);
        start();
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void start() {
        if (webView != null) return;
        ready = false;
        injected = false;
        WebView view = new WebView(activity);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(UserAgent.get(activity));
        view.addJavascriptInterface(new PoBridge(view), "CloudMusicPoBridge");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, Bitmap favicon) {
                if (v == webView) injected = false;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (v != webView || injected || url == null || !url.startsWith(BOTGUARD_PAGE)) return;
                String script = workerScript();
                if (script == null) {
                    fail("PO token worker script missing");
                    return;
                }
                injected = true;
                v.evaluateJavascript(script, null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (v == webView && request.isForMainFrame()) {
                    fail("PO token window failed to load: " + error.getDescription());
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                // the BotGuard page never navigates anywhere
                return !request.getUrl().toString().startsWith(BOTGUARD_PAGE);
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                if (v == webView) ui.post(() -> reset("PO token window closed"));
                return true;
            }
        });
        webView = view;
        activity.attachHiddenView(view);
        startTimeout = () -> fail("PO token window did not start");
        ui.postDelayed(startTimeout, START_TIMEOUT_MS);
        view.loadUrl(BOTGUARD_PAGE);
    }

    private String workerScript() {
        if (workerScript != null) return workerScript;
        try (InputStream in = activity.getAssets().open("www/potoken-worker.js")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            workerScript = out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            Log.e(TAG, "cannot read potoken-worker.js", e);
        }
        return workerScript;
    }

    private void markReady(WebView source) {
        if (source != webView || webView == null) return;
        ready = true;
        if (startTimeout != null) ui.removeCallbacks(startTimeout);
        startTimeout = null;
        List<ReadyWaiter> copy = new ArrayList<>(waiters);
        waiters.clear();
        for (ReadyWaiter waiter : copy) waiter.onReady();
    }

    private void fail(String message) {
        Log.w(TAG, message);
        List<ReadyWaiter> copy = new ArrayList<>(waiters);
        waiters.clear();
        reset(message);
        for (ReadyWaiter waiter : copy) waiter.onFailed(message);
    }

    private void settle(WebView source, String json) {
        if (source != webView) return;
        try {
            JSONObject result = new JSONObject(json);
            int id = result.optInt("id", -1);
            PendingMint entry = pending.remove(id);
            if (entry == null) return;
            if (entry.timeout != null) ui.removeCallbacks(entry.timeout);
            String token = result.optString("token", "");
            if (!token.isEmpty()) entry.callback.onToken(token);
            else entry.callback.onError(result.optString("error", "PO token minting failed"));
        } catch (Exception e) {
            Log.w(TAG, "bad mint result", e);
        }
    }

    private void downloadInterpreter(WebView source, int requestId, String url) {
        CloudMusicApp.get().io().execute(() -> {
            String text = null;
            String error = null;
            try {
                HttpUrl target = HttpUrl.parse(url);
                if (target == null || !target.isHttps() || !INTERPRETER_HOSTS.contains(target.host())) {
                    throw new IllegalArgumentException("interpreter host not allowed");
                }
                Request request = new Request.Builder().url(target).build();
                try (Response response = CloudMusicApp.get().netProxy().client().newCall(request).execute()) {
                    if (!response.isSuccessful() || response.body() == null) {
                        throw new IllegalStateException("interpreter download failed with " + response.code());
                    }
                    text = response.body().string();
                }
            } catch (Exception e) {
                error = e.getMessage() != null ? e.getMessage() : e.toString();
            }
            String script = "window.__cloudMusicPoWorker&&window.__cloudMusicPoWorker.interpreterResult(" + requestId + ","
                    + (text == null ? "null" : JSONObject.quote(text)) + ","
                    + (error == null ? "null" : JSONObject.quote(error)) + ")";
            ui.post(() -> {
                if (source == webView && webView != null) webView.evaluateJavascript(script, null);
            });
        });
    }

    private void reset(String reason) {
        if (startTimeout != null) ui.removeCallbacks(startTimeout);
        startTimeout = null;
        WebView old = webView;
        webView = null;
        ready = false;
        injected = false;
        if (old != null) {
            activity.detachHiddenView(old);
            old.stopLoading();
            old.destroy();
        }
        List<PendingMint> entries = new ArrayList<>(pending.values());
        pending.clear();
        for (PendingMint entry : entries) {
            if (entry.timeout != null) ui.removeCallbacks(entry.timeout);
            entry.callback.onError(reason);
        }
    }

    void destroy() {
        List<ReadyWaiter> copy = new ArrayList<>(waiters);
        waiters.clear();
        reset("PO token window closed");
        for (ReadyWaiter waiter : copy) waiter.onFailed("PO token window closed");
    }

    /** JavaScript interface "CloudMusicPoBridge" inside the hidden youtube.com WebView. */
    public final class PoBridge {
        private final WebView source;

        PoBridge(WebView source) {
            this.source = source;
        }

        @JavascriptInterface
        public void ready() {
            ui.post(() -> markReady(source));
        }

        @JavascriptInterface
        public void result(String json) {
            ui.post(() -> settle(source, json));
        }

        @JavascriptInterface
        public void interpreter(int requestId, String url) {
            downloadInterpreter(source, requestId, url);
        }
    }
}
