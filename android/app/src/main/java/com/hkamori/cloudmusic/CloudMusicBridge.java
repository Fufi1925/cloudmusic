package com.hkamori.cloudmusic;

import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.hkamori.cloudmusic.net.NetProxy;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * JavaScript interface "CloudMusicAndroid": the android side of cloudmusic-android.js and the
 * counterpart of every {@code ipcMain.handle / ipcMain.on} in electron/main.ts,
 * overlay.ts, touchbar.ts and potoken.ts. Channel names are identical.
 *
 * invoke() answers asynchronously through {@code window.__cloudMusicIpc.reply}, events
 * are pushed with {@code window.__cloudMusicIpc.emit}.
 */
public final class CloudMusicBridge {
    private static final String TAG = "CloudMusicBridge";
    static final String ROLE_MAIN = "main";
    static final String ROLE_OVERLAY = "overlay";

    private final MainActivity activity;
    private final WebView webView;
    private final String role;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final List<String> pendingDeeplinks = new ArrayList<>();
    private volatile boolean ready;
    private volatile boolean destroyed;

    CloudMusicBridge(MainActivity activity, WebView webView, String role) {
        this.activity = activity;
        this.webView = webView;
        this.role = role;
    }

    boolean isMain() {
        return ROLE_MAIN.equals(role);
    }

    boolean isReady() {
        return ready && !destroyed;
    }

    void destroy() {
        destroyed = true;
    }

    private NetProxy net() {
        return CloudMusicApp.get().netProxy();
    }

    // ------------------------------------------------------------ JS -> native

    @JavascriptInterface
    public String getInfo() {
        JSONObject info = new JSONObject();
        try {
            info.put("platform", "android");
            info.put("role", role);
            info.put("appVersion", BuildConfig.VERSION_NAME);
            info.put("sdkInt", Build.VERSION.SDK_INT);
            info.put("phone", activity.isPhone());
            info.put("viewport", activity.viewportJson());
            info.put("uiScale", activity.uiScale());
            info.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        } catch (JSONException ignored) {
            // static keys
        }
        return info.toString();
    }

    @JavascriptInterface
    public void invoke(String callId, String channel, String argsJson) {
        JSONArray args = parseArgs(argsJson);
        try {
            onInvoke(callId, channel == null ? "" : channel, args);
        } catch (Throwable t) {
            Log.w(TAG, "invoke " + channel + " failed", t);
            reject(callId, t.getMessage() != null ? t.getMessage() : t.toString());
        }
    }

    @JavascriptInterface
    public void send(String channel, String argsJson) {
        JSONArray args = parseArgs(argsJson);
        try {
            onSend(channel == null ? "" : channel, args);
        } catch (Throwable t) {
            Log.w(TAG, "send " + channel + " failed", t);
        }
    }

    private void onInvoke(String callId, String channel, JSONArray args) {
        switch (channel) {
            // ---- window controls (main.ts "window:*")
            case "window:minimize":
                ui.post(activity::minimizeWindow);
                resolve(callId, null);
                break;
            case "window:toggle-maximize":
            case "window:toggle-fullscreen":
                ui.post(activity::toggleImmersive);
                resolve(callId, null);
                break;
            case "window:close":
                resolve(callId, null);
                ui.postDelayed(activity::closeApp, 50);
                break;
            case "window:is-maximized":
                resolve(callId, activity.isImmersiveMode());
                break;
            case "window:is-fullscreen":
                resolve(callId, false);
                break;

            // ---- app / shell / dialogs
            case "app:set-icon": {
                String dataUrl = str(args, 0);
                if (dataUrl != null) ui.post(() -> activity.setTaskIcon(dataUrl));
                resolve(callId, null);
                break;
            }
            case "dialog:save-dump": {
                JSONObject input = args.optJSONObject(0);
                ui.post(() -> activity.saveDump(input, result -> resolve(callId, result)));
                break;
            }
            case "shell:open-downloads":
            case "shell:open-export-folder":
                ui.post(() -> resolve(callId, activity.openExport()));
                break;
            case "shell:open-cache-folder":
                // app-private storage cannot be opened in a file manager on android
                resolve(callId, false);
                break;

            // ---- storage (main.ts "storage:*")
            case "storage:get-cache-stats":
                CloudMusicApp.get().io().execute(() -> resolve(callId, CacheStats.compute(activity, net())));
                break;
            case "storage:clear-covers-cache":
                // cache storage + service workers are cleared on the web side
                resolve(callId, true);
                break;
            case "storage:clear-audio-cache":
            case "storage:clear-http-cache":
                ui.post(() -> {
                    activity.clearWebViewCache();
                    CloudMusicApp.get().io().execute(() -> {
                        net().clearCache();
                        resolve(callId, true);
                    });
                });
                break;

            // ---- offline dump diagnostics (main.ts "net:diagnose")
            case "net:diagnose": {
                JSONArray hosts = args.optJSONArray(0);
                CloudMusicApp.get().io().execute(() -> resolve(callId, NetDiag.run(activity, net(), hosts)));
                break;
            }

            // ---- custom discord rich presence (android gateway client)
            case "discord:get-status":
                resolve(callId, CloudMusicApp.get().discordRpc().status());
                break;
            case "discord:set-token":
                resolve(callId, CloudMusicApp.get().discordRpc().setToken(str(args, 0)));
                break;
            case "discord:clear-token":
                resolve(callId, CloudMusicApp.get().discordRpc().clearToken());
                break;
            case "discord:set-enabled":
                resolve(callId, CloudMusicApp.get().discordRpc().setEnabled(args.optBoolean(0, true)));
                break;
            case "discord:open-login":
                ui.post(() -> activity.openDiscordLogin());
                resolve(callId, null);
                break;

            // ---- BotGuard PO tokens (potoken.ts "potoken:mint")
            case "potoken:mint": {
                String identifier = str(args, 0);
                ui.post(() -> activity.poTokens().mint(identifier, new PoTokenService.Callback() {
                    @Override
                    public void onToken(String token) {
                        resolve(callId, token);
                    }

                    @Override
                    public void onError(String message) {
                        reject(callId, message);
                    }
                }));
                break;
            }

            // ---- overlay (overlay.ts)
            case "overlay:toggle":
                ui.post(() -> resolve(callId, activity.overlay().toggle()));
                break;
            case "overlay:is-open":
                ui.post(() -> resolve(callId, activity.overlay().isOpen()));
                break;
            case "overlay:get-initial-state":
                ui.post(() -> resolve(callId, activity.overlay().initialState()));
                break;

            // ---- android helpers
            case "clipboard:write-text": {
                String text = str(args, 0);
                ui.post(() -> {
                    activity.copyToClipboard(text == null ? "" : text);
                    resolve(callId, null);
                });
                break;
            }
            default:
                reject(callId, "No handler registered for '" + channel + "'");
        }
    }

    private void onSend(String channel, JSONArray args) {
        switch (channel) {
            case "android:ready":
                ready = true;
                ui.post(() -> {
                    activity.onBridgeReady(this);
                    for (String url : pendingDeeplinks) emit("android:deeplink", url);
                    pendingDeeplinks.clear();
                });
                break;
            case "touchbar:update-state": {
                JSONObject state = args.optJSONObject(0);
                if (state != null && isMain()) ui.post(() -> activity.onMediaState(state));
                break;
            }
            case "touchbar:send-action": {
                JSONObject action = args.optJSONObject(0);
                if (action != null) ui.post(() -> activity.dispatchTouchbarAction(action));
                break;
            }
            case "overlay:update-state": {
                Object state = args.opt(0);
                ui.post(() -> activity.overlay().updateState(state));
                break;
            }
            case "overlay:send-action": {
                JSONObject action = args.optJSONObject(0);
                if (action != null) ui.post(() -> activity.overlay().onOverlayAction(action));
                break;
            }
            case "overlay:close":
                ui.post(() -> activity.overlay().close());
                break;
            case "overlay:update-settings": {
                JSONObject settings = args.optJSONObject(0);
                if (settings != null) ui.post(() -> activity.overlay().updateSettings(settings));
                break;
            }
            case "overlay:set-authenticated": {
                boolean authenticated = args.optBoolean(0, false);
                ui.post(() -> activity.overlay().setAuthenticated(authenticated));
                break;
            }
            case "android:viewport-applied": {
                JSONObject applied = args.optJSONObject(0);
                if (applied != null && isMain()) {
                    double max = applied.optDouble("maxUiScale", 1.6);
                    ui.post(() -> activity.onViewportApplied((float) max));
                }
                break;
            }
            case "shell:open-external": {
                String url = str(args, 0);
                if (url != null) ui.post(() -> activity.openExternal(url));
                break;
            }
            case "discord:update-state": {
                JSONObject payload = args.optJSONObject(0);
                if (payload != null) CloudMusicApp.get().discordRpc().updateState(payload);
                break;
            }
            case "discord:update-settings": {
                JSONObject patch = args.optJSONObject(0);
                if (patch != null) CloudMusicApp.get().discordRpc().updateSettings(patch);
                break;
            }
            case "overlay:pause-shortcuts":
            case "window:drag-start":
            case "window:drag-move":
            case "window:drag-end":
            default:
                // no global shortcuts or movable windows on android
                break;
        }
    }

    // ------------------------------------------------------------ native -> JS

    void resolve(String callId, Object value) {
        reply(callId, true, toJson(value));
    }

    void reject(String callId, String message) {
        JSONObject error = new JSONObject();
        try {
            error.put("message", message == null ? "error" : message);
        } catch (JSONException ignored) {
            // constant key
        }
        reply(callId, false, error.toString());
    }

    private void reply(String callId, boolean ok, String json) {
        if (callId == null) return;
        eval("window.__cloudMusicIpc&&window.__cloudMusicIpc.reply(" + JSONObject.quote(callId) + "," + ok + ","
                + JSONObject.quote(json) + ")");
    }

    void emit(String channel, Object payload) {
        eval("window.__cloudMusicIpc&&window.__cloudMusicIpc.emit(" + JSONObject.quote(channel) + ","
                + JSONObject.quote(toJson(payload)) + ")");
    }

    void deliverDeeplink(String url) {
        ui.post(() -> {
            if (isReady()) emit("android:deeplink", url);
            else pendingDeeplinks.add(url);
        });
    }

    private void eval(String script) {
        ui.post(() -> {
            if (destroyed) return;
            try {
                webView.evaluateJavascript(script, null);
            } catch (Exception e) {
                Log.w(TAG, "evaluateJavascript failed", e);
            }
        });
    }

    // ---------------------------------------------------------------- helpers

    private static JSONArray parseArgs(String json) {
        if (json == null || json.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(json);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static String str(JSONArray args, int index) {
        if (args == null || index >= args.length() || args.isNull(index)) return null;
        Object value = args.opt(index);
        return value == null ? null : String.valueOf(value);
    }

    static String toJson(Object value) {
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof JSONObject || value instanceof JSONArray) return value.toString();
        if (value instanceof String) return JSONObject.quote((String) value);
        if (value instanceof Boolean || value instanceof Integer || value instanceof Long) return value.toString();
        if (value instanceof Number) {
            try {
                return JSONObject.numberToString((Number) value);
            } catch (JSONException e) {
                return "null";
            }
        }
        return JSONObject.quote(String.valueOf(value));
    }
}
