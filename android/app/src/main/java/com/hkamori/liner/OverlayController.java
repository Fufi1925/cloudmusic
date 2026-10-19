package com.hkamori.liner;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Port of electron/overlay.ts: the floating 320x56 mini player (route #/overlay
 * of the very same renderer) shown above other apps. Electron shows it when the
 * main window is minimized ("autoShowOnMinimize") and hides it on restore; on
 * android "minimized" means the app went to the background. Needs the
 * "display over other apps" permission, requested when the user turns the
 * overlay on in Settings -> Overlay.
 */
final class OverlayController {
    private static final String TAG = "LinerOverlay";
    private static final int WIDTH_DP = 320;
    private static final int HEIGHT_DP = 56;
    private static final int PADDING_DP = 20;

    private final MainActivity activity;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final WindowManager windowManager;
    private final SharedPreferences prefs;

    private WebView webView;
    private LinerBridge bridge;
    private FrameLayout container;
    private boolean attached;
    private Runnable pendingHide;
    private Object latestState;

    private boolean enabled;
    private String position;
    private boolean autoShowOnMinimize;
    private boolean alwaysOnTop;
    private boolean authenticated;
    private boolean wasAutoOpened;
    private int settingsUpdates;
    private boolean permissionPrompted;

    OverlayController(MainActivity activity) {
        this.activity = activity;
        this.windowManager = (WindowManager) activity.getSystemService(android.content.Context.WINDOW_SERVICE);
        this.prefs = activity.getSharedPreferences("liner_overlay", android.content.Context.MODE_PRIVATE);
        // electron: overlay-settings.json defaults
        enabled = prefs.getBoolean("enabled", true);
        position = prefs.getString("position", "top-center");
        autoShowOnMinimize = prefs.getBoolean("autoShowOnMinimize", true);
        alwaysOnTop = prefs.getBoolean("alwaysOnTop", true);
    }

    // ------------------------------------------------- main window lifecycle

    void onMainMinimized() {
        if (!authenticated || !enabled || !autoShowOnMinimize || !canDrawOverlays()) return;
        wasAutoOpened = true;
        ui.postDelayed(() -> {
            if (authenticated && wasAutoOpened) show();
        }, 50);
    }

    void onMainRestored() {
        if (wasAutoOpened) {
            wasAutoOpened = false;
            close();
        }
    }

    void onMainPageLoaded() {
        settingsUpdates = 0;
    }

    // ---------------------------------------------------------- ipc handlers

    boolean toggle() {
        if (!authenticated || !enabled) {
            close();
            return false;
        }
        wasAutoOpened = false;
        if (isOpen()) {
            close();
            return false;
        }
        if (!canDrawOverlays()) {
            requestPermission();
            return false;
        }
        show();
        return true;
    }

    boolean isOpen() {
        return attached && pendingHide == null;
    }

    Object initialState() {
        return authenticated ? latestState : null;
    }

    void updateState(Object state) {
        if (!authenticated) return;
        latestState = state;
        if (bridge != null && attached) bridge.emit("overlay:state", state);
    }

    void onOverlayAction(JSONObject action) {
        String type = action.optString("type");
        if ("closeOverlay".equals(type)) {
            close();
            return;
        }
        if ("focusMainWindow".equals(type)) {
            activity.bringToFront();
            return;
        }
        activity.emitToMain("overlay:action", action);
    }

    void setAuthenticated(boolean value) {
        authenticated = value;
        if (!value) close();
    }

    void updateSettings(JSONObject settings) {
        settingsUpdates++;
        boolean wasEnabled = enabled;
        boolean userFacingChange = false;
        if (settings.has("enabled")) {
            enabled = settings.optBoolean("enabled", enabled);
            if (!enabled) close();
            userFacingChange |= enabled && !wasEnabled;
        }
        String nextPosition = settings.optString("position", "");
        if (nextPosition.equals("top-left") || nextPosition.equals("top-center") || nextPosition.equals("top-right")) {
            userFacingChange |= !nextPosition.equals(position);
            position = nextPosition;
            if (attached) relayout();
        }
        if (settings.has("autoShowOnMinimize")) {
            boolean value = settings.optBoolean("autoShowOnMinimize", autoShowOnMinimize);
            userFacingChange |= value != autoShowOnMinimize;
            autoShowOnMinimize = value;
        }
        if (settings.has("alwaysOnTop")) {
            boolean value = settings.optBoolean("alwaysOnTop", alwaysOnTop);
            userFacingChange |= value != alwaysOnTop;
            alwaysOnTop = value;
        }
        prefs.edit()
                .putBoolean("enabled", enabled)
                .putString("position", position)
                .putBoolean("autoShowOnMinimize", autoShowOnMinimize)
                .putBoolean("alwaysOnTop", alwaysOnTop)
                .apply();
        // the first update after a page load is the renderer syncing its stored
        // settings; later ones are the user changing the overlay settings
        if (settingsUpdates > 1 && userFacingChange && enabled && !canDrawOverlays()) requestPermission();
    }

    void close() {
        wasAutoOpened = false;
        if (pendingHide != null) {
            ui.removeCallbacks(pendingHide);
            pendingHide = null;
        }
        if (!attached) return;
        if (bridge != null) bridge.emit("overlay:visibility", false);
        pendingHide = () -> {
            pendingHide = null;
            detach();
        };
        ui.postDelayed(pendingHide, 90);
    }

    void onOverlayReady(LinerBridge readyBridge) {
        if (readyBridge != bridge || !attached) return;
        if (latestState != null) bridge.emit("overlay:state", latestState);
        bridge.emit("overlay:visibility", true);
    }

    void onRendererGone(WebView view) {
        if (view != webView) return;
        destroy();
    }

    void destroy() {
        if (pendingHide != null) ui.removeCallbacks(pendingHide);
        pendingHide = null;
        detach();
        if (bridge != null) bridge.destroy();
        bridge = null;
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        webView = null;
        container = null;
    }

    // --------------------------------------------------------------- window

    private boolean canDrawOverlays() {
        return Settings.canDrawOverlays(activity);
    }

    private void requestPermission() {
        if (permissionPrompted) return;
        permissionPrompted = true;
        Toast.makeText(activity, R.string.overlay_permission_hint, Toast.LENGTH_LONG).show();
        activity.markOwnActivityOnTop();
        try {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName())));
        } catch (Exception e) {
            Log.w(TAG, "cannot open overlay permission screen", e);
        }
    }

    private void show() {
        if (!authenticated || !enabled || !canDrawOverlays()) return;
        if (pendingHide != null) {
            ui.removeCallbacks(pendingHide);
            pendingHide = null;
        }
        boolean fresh = webView == null;
        ensureWebView();
        if (!attached) attach();
        else relayout();
        if (!fresh && bridge != null && bridge.isReady()) {
            if (latestState != null) bridge.emit("overlay:state", latestState);
            bridge.emit("overlay:visibility", true);
        }
    }

    @SuppressLint("JavascriptInterface")
    private void ensureWebView() {
        if (webView != null) return;
        webView = activity.buildWebView(true);
        bridge = new LinerBridge(activity, webView, LinerBridge.ROLE_OVERLAY);
        webView.addJavascriptInterface(bridge, "LinerAndroid");
        webView.setWebViewClient(activity.appClient(false));
        webView.setWebChromeClient(activity.chromeClient());
        container = new FrameLayout(activity);
        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(MainActivity.APP_URL + "#/overlay");
    }

    private void attach() {
        if (container == null) return;
        try {
            windowManager.addView(container, layoutParams());
            attached = true;
        } catch (Exception e) {
            Log.w(TAG, "overlay window refused", e);
            attached = false;
        }
    }

    private void detach() {
        if (!attached || container == null) {
            attached = false;
            return;
        }
        try {
            windowManager.removeView(container);
        } catch (Exception ignored) {
            // already removed
        }
        attached = false;
    }

    private void relayout() {
        if (!attached || container == null) return;
        try {
            windowManager.updateViewLayout(container, layoutParams());
        } catch (Exception e) {
            Log.w(TAG, "overlay relayout failed", e);
        }
    }

    private WindowManager.LayoutParams layoutParams() {
        float density = activity.getResources().getDisplayMetrics().density;
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                Math.round(WIDTH_DP * density),
                Math.round(HEIGHT_DP * density),
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        int horizontal;
        switch (position) {
            case "top-left":
                horizontal = Gravity.START;
                lp.x = Math.round(PADDING_DP * density);
                break;
            case "top-right":
                horizontal = Gravity.END;
                lp.x = Math.round(PADDING_DP * density);
                break;
            default:
                horizontal = Gravity.CENTER_HORIZONTAL;
                lp.x = 0;
        }
        lp.gravity = Gravity.TOP | horizontal;
        lp.y = statusBarHeight() + Math.round(8 * density);
        lp.setTitle("Liner Overlay");
        return lp;
    }

    @SuppressLint({"InternalInsetResource", "DiscouragedApi"})
    private int statusBarHeight() {
        int id = activity.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? activity.getResources().getDimensionPixelSize(id) : 0;
    }
}
