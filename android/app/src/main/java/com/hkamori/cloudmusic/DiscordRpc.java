package com.hkamori.cloudmusic;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * "Custom Discord RPC" for Android.
 *
 * The desktop build talks to the local Discord client over its IPC socket. A
 * phone has no Discord IPC, so this implementation signs into Discord's own
 * gateway (wss://gateway.discord.gg) with the user's token and publishes a
 * type-2 ("Listening to ...") activity, exactly like the desktop presence.
 *
 * The token is read from {@link DiscordTokenStore} (AES/GCM, Android keystore),
 * kept in memory only while the app runs, and is never sent anywhere except
 * Discord's gateway.
 *
 * Every state mutation happens on the main thread; OkHttp callbacks are posted
 * there, so no extra locking is required.
 */
public final class DiscordRpc {
    private static final String TAG = "CloudMusicDiscord";
    private static final String GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
    private static final long MIN_PRESENCE_INTERVAL_MS = 4_000;
    private static final long HEARTBEAT_FALLBACK_MS = 41_250;
    private static final long RECONNECT_BASE_MS = 5_000;
    private static final long RECONNECT_MAX_MS = 60_000;
    private static final int MAX_TEXT_LENGTH = 128;
    private static final int MAX_IMAGE_URL_LENGTH = 256;

    /** close code discord uses when the token is rejected */
    private static final int CLOSE_INVALID_TOKEN = 4004;

    // error codes, translated by the renderer (settings.discord.android.error_*)
    static final String ERROR_INVALID_FORMAT = "invalid_format";
    static final String ERROR_INVALID_TOKEN = "invalid_token";
    static final String ERROR_CONNECT_FAILED = "connect_failed";

    private final DiscordTokenStore store;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final OkHttpClient http;

    private WebSocket socket;
    private String token;
    private boolean enabled = true;
    private boolean destroyed;

    private boolean connecting;
    private volatile boolean connected;
    private volatile String username;
    private volatile String lastError;

    private int reconnectAttempts;
    private int sequence;
    private long heartbeatIntervalMs = HEARTBEAT_FALLBACK_MS;
    private boolean heartbeatAck = true;

    private JSONObject settings = defaultSettings();
    private JSONObject latestPayload;
    private long latestPayloadAt;
    private long lastPresenceAt;
    private boolean presenceScheduled;
    private boolean presencePending;

    DiscordRpc(Context context) {
        this.store = new DiscordTokenStore(context);
        this.http = new OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(30, TimeUnit.SECONDS)
                .build();
    }

    // ------------------------------------------------------------- lifecycle

    /** called once from the application object: restores the local token */
    void start() {
        token = store.load();
        if (token != null) connect();
    }

    void destroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        closeSocket(1000, "app closing");
        token = null;
        connected = false;
    }

    // ------------------------------------------------------------- public api

    JSONObject status() {
        JSONObject out = new JSONObject();
        try {
            out.put("platform", "android");
            out.put("hasToken", token != null || store.hasToken());
            out.put("enabled", enabled);
            out.put("connected", connected);
            if (username != null) out.put("username", username);
            if (lastError != null) out.put("error", lastError);
        } catch (Exception ignored) {
            // constant keys
        }
        return out;
    }

    /** stores the token encrypted on the device and connects right away */
    JSONObject setToken(String rawToken) {
        String trimmed = rawToken == null ? "" : rawToken.trim();
        if (trimmed.length() < 20 || trimmed.contains(" ") || trimmed.contains("\n")) {
            try {
                JSONObject out = status();
                out.put("error", ERROR_INVALID_FORMAT);
                return out;
            } catch (Exception ignored) {
                return status();
            }
        }
        store.save(trimmed);
        token = trimmed;
        lastError = null;
        reconnectAttempts = 0;
        closeSocket(1000, "token changed");
        connected = false;
        connect();
        return status();
    }

    JSONObject clearToken() {
        store.clear();
        token = null;
        username = null;
        lastError = null;
        connected = false;
        closeSocket(1000, "token cleared");
        return status();
    }

    JSONObject setEnabled(boolean value) {
        enabled = value;
        if (!enabled) {
            connected = false;
            closeSocket(1000, "disabled");
        } else if (token != null) {
            connect();
        }
        return status();
    }

    /** renderer player state (same shape as the electron discord:update-state payload) */
    void updateState(JSONObject payload) {
        latestPayload = payload;
        latestPayloadAt = System.currentTimeMillis();
        if (!enabled) return;
        if (!connected && !connecting && token != null) connect();
        if (connected) schedulePresence();
    }

    /** renderer display settings (same shape as discord:update-settings) */
    void updateSettings(JSONObject patch) {
        if (patch == null) return;
        JSONObject next = new JSONObject();
        try {
            JSONObject current = settings;
            java.util.Iterator<String> keys = patch.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                current.put(key, patch.get(key));
            }
            next = current;
        } catch (Exception ignored) {
            // keep previous settings
        }
        settings = next;
        if (patch.has("enabled")) {
            setEnabled(settings.optBoolean("enabled", true));
            return;
        }
        if (connected) schedulePresence();
    }

    // ------------------------------------------------------------- gateway

    private void connect() {
        if (destroyed || !enabled || token == null || socket != null) return;
        connecting = true;
        lastError = null;
        Request request = new Request.Builder().url(GATEWAY_URL).build();
        socket = http.newWebSocket(request, listener);
    }

    private void reconnect(String reason, boolean immediate) {
        if (destroyed) return;
        connected = false;
        connecting = false;
        closeSocket(1001, reason);
        if (!enabled || token == null) return;
        reconnectAttempts = Math.min(reconnectAttempts + 1, 6);
        long backoff = Math.min(RECONNECT_MAX_MS,
                RECONNECT_BASE_MS * (1L << Math.min(reconnectAttempts - 1, 4)));
        long jitter = (long) (backoff * 0.2 * Math.random());
        long delay = immediate ? 1_000 : backoff + jitter;
        handler.postDelayed(this::connect, delay);
    }

    private void closeSocket(int code, String reason) {
        WebSocket current = socket;
        socket = null;
        connecting = false;
        if (current != null) {
            try {
                current.close(code, reason);
            } catch (Throwable ignored) {
                // already gone
            }
        }
        handler.removeCallbacks(heartbeatRunnable);
    }

    private final WebSocketListener listener = new WebSocketListener() {
        @Override
        public void onMessage(WebSocket ws, String text) {
            handler.post(() -> handleGatewayMessage(ws, text));
        }

        @Override
        public void onFailure(WebSocket ws, Throwable t, Response response) {
            handler.post(() -> {
                if (ws != socket) return;
                lastError = ERROR_CONNECT_FAILED;
                Log.w(TAG, "gateway failure: " + t.getClass().getSimpleName());
                reconnect("failure", false);
            });
        }

        @Override
        public void onClosing(WebSocket ws, int code, String reason) {
            handler.post(() -> {
                if (ws != socket) return;
                boolean invalidToken = code == CLOSE_INVALID_TOKEN;
                if (invalidToken) {
                    lastError = ERROR_INVALID_TOKEN;
                    connected = false;
                    closeSocket(1000, "invalid token");
                } else {
                    reconnect("closed", false);
                }
            });
        }
    };

    private void handleGatewayMessage(WebSocket ws, String text) {
        if (ws != socket) return;
        JSONObject message;
        try {
            message = new JSONObject(text);
        } catch (Exception e) {
            return;
        }
        if (message.has("s") && !message.isNull("s")) {
            sequence = message.optInt("s", sequence);
        }
        int op = message.optInt("op", -1);
        JSONObject d = message.optJSONObject("d");
        switch (op) {
            case 10: { // hello -> start heartbeats, identify
                heartbeatIntervalMs = (long) d.optDouble("heartbeat_interval", HEARTBEAT_FALLBACK_MS);
                heartbeatAck = true;
                handler.removeCallbacks(heartbeatRunnable);
                handler.postDelayed(heartbeatRunnable, heartbeatIntervalMs);
                sendIdentify();
                break;
            }
            case 11: // heartbeat ack
                heartbeatAck = true;
                break;
            case 1: // server requested a heartbeat
                sendHeartbeat();
                break;
            case 7: // reconnect
                reconnect("gateway requested reconnect", true);
                break;
            case 9: { // invalid session
                boolean resumable = d != null && d.optBoolean("resumable", false);
                if (!resumable) sequence = 0;
                reconnect("invalid session", false);
                break;
            }
            case 0: {
                String type = message.optString("t", "");
                if ("READY".equals(type)) {
                    connecting = false;
                    connected = true;
                    reconnectAttempts = 0;
                    lastError = null;
                    JSONObject user = d == null ? null : d.optJSONObject("user");
                    if (user != null) {
                        String name = user.optString("global_name", "");
                        if (name.isEmpty()) name = user.optString("username", "");
                        username = name.isEmpty() ? null : name;
                    }
                    lastPresenceAt = 0;
                    schedulePresence();
                } else if ("RESUMED".equals(type)) {
                    connecting = false;
                    connected = true;
                    lastPresenceAt = 0;
                    schedulePresence();
                }
                break;
            }
            default:
                break;
        }
    }

    private void sendIdentify() {
        try {
            JSONObject properties = new JSONObject();
            properties.put("os", "Android");
            properties.put("browser", "CloudMusic");
            properties.put("device", "cloudmusic");

            JSONObject presence = new JSONObject();
            presence.put("status", "online");
            presence.put("since", 0);
            presence.put("activities", new JSONArray());
            presence.put("afk", false);

            JSONObject d = new JSONObject();
            d.put("token", token);
            d.put("capabilities", 125);
            d.put("properties", properties);
            d.put("presence", presence);
            d.put("compress", false);
            sendOp(2, d);
        } catch (Exception e) {
            lastError = ERROR_CONNECT_FAILED;
        }
    }

    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            if (socket == null) return;
            if (!heartbeatAck) {
                reconnect("heartbeat missed", false);
                return;
            }
            sendHeartbeat();
            handler.postDelayed(this, heartbeatIntervalMs);
        }
    };

    private void sendHeartbeat() {
        // the gateway expects the last sequence number (or null) as the payload
        heartbeatAck = false;
        sendOp(1, sequence == 0 ? JSONObject.NULL : sequence);
    }

    private void sendOp(int op, Object d) {
        WebSocket current = socket;
        if (current == null) return;
        try {
            JSONObject message = new JSONObject();
            message.put("op", op);
            message.put("d", d);
            current.send(message.toString());
        } catch (Exception ignored) {
            // socket already closed
        }
    }

    // ------------------------------------------------------------- presence

    private void schedulePresence() {
        if (!enabled || !connected) return;
        long sinceLast = System.currentTimeMillis() - lastPresenceAt;
        long wait = Math.max(0, MIN_PRESENCE_INTERVAL_MS - sinceLast);
        presencePending = true;
        if (presenceScheduled) return;
        presenceScheduled = true;
        handler.postDelayed(presenceRunnable, wait);
    }

    private final Runnable presenceRunnable = new Runnable() {
        @Override
        public void run() {
            presenceScheduled = false;
            if (!presencePending) return;
            presencePending = false;
            pushPresence();
        }
    };

    private void pushPresence() {
        if (!enabled || !connected || socket == null) return;
        try {
            JSONObject activity = buildActivity();
            JSONArray activities = new JSONArray();
            if (activity != null) activities.put(activity);

            JSONObject d = new JSONObject();
            d.put("since", 0);
            d.put("activities", activities);
            d.put("status", "online");
            d.put("afk", false);
            sendOp(3, d);
            lastPresenceAt = System.currentTimeMillis();
        } catch (Exception ignored) {
            // presence update dropped
        }
    }

    /** mirrors DiscordRpcManager.syncActivity() on the desktop side */
    private JSONObject buildActivity() {
        JSONObject payload = latestPayload;
        if (payload == null) return null;

        JSONObject track = payload.optJSONObject("track");
        if (track == null) return null;

        String status = payload.optString("status", "idle");
        if ("idle".equals(status) || "error".equals(status)) return null;

        boolean playing = "playing".equals(status);
        boolean paused = "paused".equals(status);
        if (paused && !settings.optBoolean("showPaused", true)) return null;

        String title = sanitize(track.optString("title", ""));
        String artist = sanitize(track.optString("artist", ""));
        if (title == null) title = "Unknown Title";
        if (artist == null) artist = "Unknown Artist";

        String display = settings.optString("statusDisplayType", "artist");
        String name;
        String details;
        String state;
        switch (display) {
            case "title":
                name = title;
                details = paused ? title + " (Paused)" : title;
                state = artist;
                break;
            case "app":
                name = "CloudMusic";
                details = title;
                state = paused ? artist + " (Paused)" : artist;
                break;
            case "artist_title":
                name = sanitize(artist + " - " + title);
                details = title;
                state = paused ? artist + " - " + title + " (Paused)" : artist + " - " + title;
                break;
            case "title_artist":
                name = sanitize(title + " - " + artist);
                details = paused ? title + " - " + artist + " (Paused)" : title + " - " + artist;
                state = artist;
                break;
            case "artist":
            default:
                name = artist;
                details = title;
                state = paused ? artist + " (Paused)" : artist;
                break;
        }

        try {
            JSONObject activity = new JSONObject();
            activity.put("name", name == null ? "CloudMusic" : name);
            activity.put("type", 2); // 2 = listening -> "Listening to ..."
            if (details != null) activity.put("details", details);
            if (state != null) activity.put("state", state);

            long duration = Math.max(0, payload.optLong("durationMs", track.optLong("durationMs", 0)));
            if (playing && settings.optBoolean("showTime", true) && duration > 0) {
                long now = System.currentTimeMillis();
                long elapsed = Math.max(0, now - latestPayloadAt);
                long position = Math.min(duration, Math.max(0, payload.optLong("positionMs", 0) + elapsed));
                JSONObject timestamps = new JSONObject();
                timestamps.put("start", now - position);
                timestamps.put("end", now - position + duration);
                activity.put("timestamps", timestamps);
            }

            JSONObject assets = new JSONObject();
            String cover = httpsUrl(track.optString("coverUrl", ""));
            if (settings.optBoolean("showArtwork", true) && cover != null) {
                assets.put("large_image", cover);
                String album = sanitize(track.optString("album", ""));
                assets.put("large_text", album != null ? album : title);
            }
            String artistImage = httpsUrl(payload.optString("artistImageUrl", ""));
            if (settings.optBoolean("showArtistSmallImage", true) && artistImage != null) {
                assets.put("small_image", artistImage);
                assets.put("small_text", artist);
            }
            if (assets.length() > 0) activity.put("assets", assets);

            return activity;
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------- helpers

    private static JSONObject defaultSettings() {
        JSONObject json = new JSONObject();
        try {
            json.put("enabled", true);
            json.put("statusDisplayType", "artist");
            json.put("showArtwork", true);
            json.put("showArtistSmallImage", true);
            json.put("showTime", true);
            json.put("showPaused", true);
            json.put("showButton", true);
            json.put("showDownloadButton", false);
        } catch (Exception ignored) {
            // constant keys
        }
        return json;
    }

    private static String sanitize(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return null;
        if (trimmed.length() == 1) return trimmed + " ";
        return trimmed.length() > MAX_TEXT_LENGTH ? trimmed.substring(0, MAX_TEXT_LENGTH) : trimmed;
    }

    private static String httpsUrl(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (!trimmed.startsWith("https://") || trimmed.length() > MAX_IMAGE_URL_LENGTH) return null;
        return trimmed;
    }
}
