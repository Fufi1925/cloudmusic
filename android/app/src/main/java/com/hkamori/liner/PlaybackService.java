package com.hkamori.liner;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import okhttp3.Request;
import okhttp3.Response;

/**
 * The macOS Touch Bar of the desktop app becomes android's media controls.
 * The renderer already pushes its playback state through
 * {@code touchbarUpdateState} and handles {@code onTouchBarAction}
 * (togglePlay / play / pause / next / prev / seek / like); this service turns
 * that into a MediaSession with notification, lock screen and headset buttons,
 * and is the foreground service that keeps the WebView playing in the
 * background (electron: backgroundThrottling false + powerSaveBlocker).
 *
 * Audio focus is deliberately NOT requested here: the WebView already requests
 * it for the {@code <audio>} element and pauses/ducks on its own; a second focus
 * holder in the same app would steal focus from the WebView.
 */
public final class PlaybackService extends Service {
    private static final String TAG = "LinerPlayback";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFIX = "com.hkamori.liner.playback.";
    static final String ACTION_UPDATE = PREFIX + "UPDATE";
    private static final String ACTION_PLAY = PREFIX + "PLAY";
    private static final String ACTION_PAUSE = PREFIX + "PAUSE";
    private static final String ACTION_NEXT = PREFIX + "NEXT";
    private static final String ACTION_PREV = PREFIX + "PREV";
    private static final String ACTION_LIKE = PREFIX + "LIKE";
    private static final String ACTION_DISMISS = PREFIX + "DISMISS";
    private static final String CUSTOM_LIKE = "liner.like";
    /** keep the foreground state through short pauses so headset / notification resume always works */
    private static final long PAUSED_FOREGROUND_GRACE_MS = 10 * 60 * 1000L;
    private static final int ARTWORK_MAX_PX = 512;

    interface ActionSink {
        void onAction(JSONObject action);

        void onDeviceChange();
    }

    private static volatile ActionSink sink;
    private static volatile JSONObject latestState;
    private static PlaybackService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable demote = this::demoteFromForeground;
    private MediaSessionCompat session;
    private NotificationManagerCompat notifications;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean foreground;
    private boolean noisyRegistered;
    private String metadataKey;
    private String artworkUrl;
    private String loadingArtworkUrl;
    private Bitmap artwork;

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                // headphones unplugged / bluetooth gone: the renderer's own
                // "pause on device change" setting decides (navigator.mediaDevices devicechange)
                ActionSink target = sink;
                if (target != null) target.onDeviceChange();
            }
        }
    };

    // ----------------------------------------------------------- static api

    static void setActionSink(ActionSink actionSink) {
        sink = actionSink;
    }

    /** touchbar:update-state from the renderer (main thread). */
    static void update(Context context, JSONObject state) {
        latestState = state;
        if (instance != null) {
            instance.apply(state);
            return;
        }
        if (isActive(state)) {
            try {
                ContextCompat.startForegroundService(context, new Intent(context, PlaybackService.class).setAction(ACTION_UPDATE));
            } catch (Exception e) {
                Log.w(TAG, "cannot start playback service", e);
            }
        }
    }

    static void stop(Context context) {
        latestState = null;
        if (instance != null) instance.shutdown();
        else context.stopService(new Intent(context, PlaybackService.class));
    }

    private static boolean isActive(JSONObject state) {
        return state != null && state.optJSONObject("track") != null && isPlayingStatus(state.optString("status"));
    }

    private static boolean isPlayingStatus(String status) {
        return "playing".equals(status) || "loading".equals(status) || "buffering".equals(status);
    }

    // ------------------------------------------------------------ lifecycle

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notifications = NotificationManagerCompat.from(this);

        session = new MediaSessionCompat(this, "Liner");
        session.setCallback(new SessionCallback(), handler);
        session.setSessionActivity(openAppIntent());
        session.setActive(true);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "liner:playback");
            wakeLock.setReferenceCounted(false);
        }
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            @SuppressWarnings("deprecation")
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wm.createWifiLock(mode, "liner:playback");
            wifiLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        instance = this;
        String action = intent == null ? null : intent.getAction();
        if (ACTION_UPDATE.equals(action)) {
            // started through startForegroundService(): startForeground() is mandatory
            promote();
            apply(latestState);
            return START_NOT_STICKY;
        }
        if (action == null) {
            apply(latestState);
            return START_NOT_STICKY;
        }
        switch (action) {
            case ACTION_PLAY:
                // a notification tap allows (re)entering the foreground from the background
                promote();
                sendAction("play", null);
                break;
            case ACTION_PAUSE:
                sendAction("pause", null);
                break;
            case ACTION_NEXT:
                if (foreground) promote();
                sendAction("next", null);
                break;
            case ACTION_PREV:
                if (foreground) promote();
                sendAction("prev", null);
                break;
            case ACTION_LIKE:
                sendAction("like", null);
                break;
            case ACTION_DISMISS:
                // paused notification swiped away
                shutdown();
                break;
            default:
                break;
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // app swiped away from recents = electron's main window closed: the app ends
        sendAction("pause", null);
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        releaseLocks();
        unregisterNoisy();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------------------------------------------------------------- state

    private void apply(JSONObject state) {
        if (state == null) return;
        JSONObject track = state.optJSONObject("track");
        String status = state.optString("status", "idle");
        if (track == null || "idle".equals(status)) {
            shutdown();
            return;
        }
        boolean active = isPlayingStatus(status);
        updateMetadata(track, state);
        updatePlaybackState(status, state);
        if (active) {
            handler.removeCallbacks(demote);
            acquireLocks();
            registerNoisy();
            if (foreground) postNotification();
            else promote();
        } else {
            releaseLocks();
            unregisterNoisy();
            postNotification();
            handler.removeCallbacks(demote);
            if (foreground) handler.postDelayed(demote, PAUSED_FOREGROUND_GRACE_MS);
        }
    }

    private void updateMetadata(JSONObject track, JSONObject state) {
        String title = track.optString("title", "");
        String artist = track.optString("artist", "");
        String album = track.optString("album", "");
        String cover = track.isNull("cover") ? null : track.optString("cover", null);
        long duration = state.optLong("durationMs", 0);
        if (duration <= 0) duration = track.optLong("durationMs", 0);

        if (cover != null && (cover.startsWith("https://") || cover.startsWith("http://"))) {
            if (!cover.equals(artworkUrl) && !cover.equals(loadingArtworkUrl)) {
                artwork = null;
                artworkUrl = null;
                loadArtwork(cover);
            }
        } else {
            artwork = null;
            artworkUrl = null;
            loadingArtworkUrl = null;
        }

        String key = title + '\u0001' + artist + '\u0001' + album + '\u0001' + duration + '\u0001' + artworkUrl;
        if (key.equals(metadataKey)) return;
        metadataKey = key;
        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration > 0 ? duration : -1L);
        if (artwork != null) {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork);
        }
        session.setMetadata(builder.build());
    }

    private void updatePlaybackState(String status, JSONObject state) {
        int playbackState;
        if ("playing".equals(status)) playbackState = PlaybackStateCompat.STATE_PLAYING;
        else if ("loading".equals(status) || "buffering".equals(status)) playbackState = PlaybackStateCompat.STATE_BUFFERING;
        else playbackState = PlaybackStateCompat.STATE_PAUSED;
        float speed = playbackState == PlaybackStateCompat.STATE_PLAYING ? (float) state.optDouble("playbackRate", 1.0) : 0f;
        boolean liked = state.optBoolean("isLiked", false);
        PlaybackStateCompat.Builder builder = new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY
                        | PlaybackStateCompat.ACTION_PAUSE
                        | PlaybackStateCompat.ACTION_PLAY_PAUSE
                        | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                        | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackStateCompat.ACTION_SEEK_TO
                        | PlaybackStateCompat.ACTION_STOP)
                .setState(playbackState, Math.max(0L, state.optLong("positionMs", 0)), speed, SystemClock.elapsedRealtime())
                .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                        CUSTOM_LIKE, getString(liked ? R.string.action_unlike : R.string.action_like),
                        liked ? R.drawable.ic_favorite : R.drawable.ic_favorite_border).build());
        session.setPlaybackState(builder.build());
    }

    private void loadArtwork(String url) {
        loadingArtworkUrl = url;
        LinerApp.get().io().execute(() -> {
            Bitmap bitmap = null;
            try {
                Request request = new Request.Builder().url(url).build();
                try (Response response = LinerApp.get().netProxy().client().newCall(request).execute()) {
                    if (response.isSuccessful() && response.body() != null) {
                        bitmap = decodeSampled(response.body().bytes());
                    }
                }
            } catch (Exception e) {
                Log.d(TAG, "artwork download failed: " + e);
            }
            Bitmap result = bitmap;
            handler.post(() -> {
                if (instance != this || !url.equals(loadingArtworkUrl)) return;
                loadingArtworkUrl = null;
                artworkUrl = url;
                artwork = result;
                metadataKey = null;
                apply(latestState);
            });
        });
    }

    private static Bitmap decodeSampled(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= ARTWORK_MAX_PX && bounds.outHeight / (sample * 2) >= ARTWORK_MAX_PX) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    // ---------------------------------------------------------- notification

    private void promote() {
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            foreground = true;
        } catch (Exception e) {
            // android 12+: not allowed to enter the foreground from the background right now
            Log.w(TAG, "startForeground refused: " + e);
            notifySafely(notification);
        }
    }

    private void demoteFromForeground() {
        if (!foreground) return;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
        foreground = false;
        notifySafely(buildNotification());
    }

    private void postNotification() {
        notifySafely(buildNotification());
    }

    @SuppressWarnings("MissingPermission")
    private void notifySafely(Notification notification) {
        try {
            notifications.notify(NOTIFICATION_ID, notification);
        } catch (SecurityException e) {
            Log.w(TAG, "notification permission missing");
        }
    }

    private Notification buildNotification() {
        JSONObject state = latestState;
        JSONObject track = state == null ? null : state.optJSONObject("track");
        String status = state == null ? "idle" : state.optString("status", "idle");
        boolean playing = isPlayingStatus(status);
        boolean liked = state != null && state.optBoolean("isLiked", false);
        String title = track == null ? getString(R.string.app_name) : track.optString("title", getString(R.string.app_name));
        String artist = track == null ? "" : track.optString("artist", "");
        String album = track == null ? "" : track.optString("album", "");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, LinerApp.PLAYBACK_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_liner)
                .setContentTitle(title)
                .setContentText(artist)
                .setSubText(album.isEmpty() ? null : album)
                .setLargeIcon(artwork)
                .setContentIntent(openAppIntent())
                .setDeleteIntent(serviceIntent(ACTION_DISMISS, 5))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setSilent(true)
                .setOngoing(playing)
                .addAction(R.drawable.ic_skip_previous, getString(R.string.action_previous), serviceIntent(ACTION_PREV, 1))
                .addAction(playing ? R.drawable.ic_pause : R.drawable.ic_play,
                        getString(playing ? R.string.action_pause : R.string.action_play),
                        serviceIntent(playing ? ACTION_PAUSE : ACTION_PLAY, 2))
                .addAction(R.drawable.ic_skip_next, getString(R.string.action_next), serviceIntent(ACTION_NEXT, 3))
                .addAction(liked ? R.drawable.ic_favorite : R.drawable.ic_favorite_border,
                        getString(liked ? R.string.action_unlike : R.string.action_like), serviceIntent(ACTION_LIKE, 4))
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    private PendingIntent openAppIntent() {
        Intent open = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ----------------------------------------------------------- utilities

    private void sendAction(String type, JSONObject payload) {
        ActionSink target = sink;
        if (target == null) return;
        JSONObject action = new JSONObject();
        try {
            action.put("type", type);
            if (payload != null) action.put("payload", payload);
        } catch (JSONException ignored) {
            // constant keys
        }
        handler.post(() -> target.onAction(action));
    }

    private void acquireLocks() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (Exception e) {
            Log.w(TAG, "lock acquire failed", e);
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception e) {
            Log.w(TAG, "lock release failed", e);
        }
    }

    private void registerNoisy() {
        if (noisyRegistered) return;
        ContextCompat.registerReceiver(this, noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED);
        noisyRegistered = true;
    }

    private void unregisterNoisy() {
        if (!noisyRegistered) return;
        try {
            unregisterReceiver(noisyReceiver);
        } catch (Exception ignored) {
            // already gone
        }
        noisyRegistered = false;
    }

    private void shutdown() {
        if (instance == this) instance = null;
        handler.removeCallbacks(demote);
        releaseLocks();
        unregisterNoisy();
        metadataKey = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        foreground = false;
        notifications.cancel(NOTIFICATION_ID);
        stopSelf();
    }

    private final class SessionCallback extends MediaSessionCompat.Callback {
        @Override
        public void onPlay() {
            promote();
            sendAction("play", null);
        }

        @Override
        public void onPause() {
            sendAction("pause", null);
        }

        @Override
        public void onStop() {
            sendAction("pause", null);
        }

        @Override
        public void onSkipToNext() {
            sendAction("next", null);
        }

        @Override
        public void onSkipToPrevious() {
            sendAction("prev", null);
        }

        @Override
        public void onSeekTo(long pos) {
            JSONObject payload = new JSONObject();
            try {
                payload.put("positionMs", Math.max(0L, pos));
            } catch (JSONException ignored) {
                // constant key
            }
            sendAction("seek", payload);
        }

        @Override
        public void onCustomAction(String action, Bundle extras) {
            if (CUSTOM_LIKE.equals(action)) sendAction("like", null);
        }
    }
}
