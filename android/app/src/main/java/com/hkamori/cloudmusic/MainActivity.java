package com.hkamori.cloudmusic;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.hkamori.cloudmusic.net.NetProxy;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

/**
 * The single cloudmusic window. Mirrors electron/main.ts createWindow(): one WebView
 * running the unchanged renderer, a native bridge in place of preload.ts, the
 * request hooks in place of session.webRequest, plus the android specifics
 * (system bars, back button, media notification, landscape on phones).
 */
public class MainActivity extends Activity {
    private static final String TAG = "CloudMusic";
    static final String APP_HOST = "appassets.androidplatform.net";
    static final String APP_ORIGIN = "https://" + APP_HOST;
    static final String APP_URL = APP_ORIGIN + "/index.html";

    private static final int REQ_FILE_CHOOSER = 41;
    private static final int REQ_SAVE_DUMP = 42;
    private static final String PREFS = "cloudmusic_android";
    private static final float MIN_UI_SCALE = 0.6f;
    private static final float MAX_UI_SCALE = 1.6f;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private FrameLayout webContainer;
    private WebView webView;
    private CloudMusicBridge mainBridge;
    private AssetServer assetServer;
    private PoTokenService poTokenService;
    private OverlayController overlayController;
    private SharedPreferences prefs;

    private boolean immersive;
    private volatile float uiScale = 1f;
    private float maxUiScale = MAX_UI_SCALE;
    private volatile int viewportWDp;
    private volatile int viewportHDp;
    private int insetLeft;
    private int insetTop;
    private int insetRight;
    private int insetBottomNoIme;
    private boolean ownActivityOnTop;
    private boolean pageRequested;
    private boolean visible;
    private boolean keepScreenOn;
    private Uri lastSavedExport;

    private ScaleGestureDetector scaleDetector;
    private boolean swallowTouches;
    private float pinchStartScale;
    private float pinchFactor;

    private ValueCallback<Uri[]> fileCallback;
    private String pendingSaveContent;
    private Consumer<JSONObject> pendingSaveCallback;

    // ------------------------------------------------------------- lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        uiScale = clamp(prefs.getFloat("ui_scale", 1f), MIN_UI_SCALE, MAX_UI_SCALE);
        immersive = prefs.getBoolean("immersive", isPhone());

        // the desktop layout needs a landscape canvas; tablets may rotate freely
        if (isPhone()) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        assetServer = new AssetServer(getAssets());
        poTokenService = new PoTokenService(this);
        overlayController = new OverlayController(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(backgroundColor());
        webContainer = new FrameLayout(this);
        root.addView(webContainer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets stableBars = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars());
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime()) && ime.bottom > 0;
            insetLeft = Math.max(bars.left, cutout.left);
            insetTop = Math.max(bars.top, cutout.top);
            insetRight = Math.max(bars.right, cutout.right);
            // android < 11 folds the keyboard into the system bar inset; the zoom level
            // must not change while typing, so the viewport uses the keyboard-free value
            int barsBottom = imeVisible ? (immersive ? 0 : stableBars.bottom) : bars.bottom;
            insetBottomNoIme = Math.max(barsBottom, cutout.bottom);
            int bottom = imeVisible ? Math.max(insetBottomNoIme, ime.bottom) : insetBottomNoIme;
            webContainer.setPadding(insetLeft, insetTop, insetRight, bottom);
            updateViewportMetrics();
            return WindowInsetsCompat.CONSUMED;
        });
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> updateViewportMetrics());

        scaleDetector = new ScaleGestureDetector(this, new PinchListener());

        PlaybackService.setActionSink(new PlaybackService.ActionSink() {
            @Override
            public void onAction(JSONObject action) {
                dispatchTouchbarAction(action);
            }

            @Override
            public void onDeviceChange() {
                if (mainBridge != null) mainBridge.emit("android:devicechange", null);
            }
        });

        createMainWebView();
        applyImmersive();
        handleIntent(getIntent());
        maybeShowScaleTip();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        visible = true;
        ownActivityOnTop = false;
        applyImmersive();
        overlayController.onMainRestored();
        if (mainBridge != null) {
            mainBridge.emit("window:restored", null);
            emitWindowState();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        visible = false;
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
            // cookie store not ready
        }
        if (mainBridge != null) {
            emitWindowState();
            mainBridge.emit("window:minimized", null);
        }
        // electron only shows the overlay on minimize; our own pickers / dialogs don't count
        if (!isFinishing() && !ownActivityOnTop) overlayController.onMainMinimized();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        root.setBackgroundColor(backgroundColor());
        if (webView != null) webView.setBackgroundColor(backgroundColor());
        applyImmersive();
    }

    void markOwnActivityOnTop() {
        ownActivityOnTop = true;
    }

    @Override
    protected void onDestroy() {
        PlaybackService.setActionSink(null);
        if (isFinishing()) PlaybackService.stop(this);
        overlayController.destroy();
        poTokenService.destroy();
        destroyMainWebView();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView == null || mainBridge == null) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return !!(window.__cloudMusicAndroid&&window.__cloudMusicAndroid.back());}catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView != null && webView.canGoBack()) webView.goBack();
                    else moveTaskToBack(true);
                });
    }

    // --------------------------------------------------------------- webview

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    WebView buildWebView(boolean transparent) {
        WebView view = new WebView(this);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // electron renders from file:// where nothing counts as mixed content
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setOffscreenPreRaster(true);
        s.setUserAgentString(UserAgent.get(this));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }
        view.setBackgroundColor(transparent ? Color.TRANSPARENT : backgroundColor());
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.setVerticalScrollBarEnabled(false);
        view.setHorizontalScrollBarEnabled(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // electron: backgroundThrottling false - keep the renderer important while music plays
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        view.addJavascriptInterface(CloudMusicApp.get().netProxy().jsInterface(), "CloudMusicNet");
        return view;
    }

    @SuppressLint("JavascriptInterface")
    private void createMainWebView() {
        webView = buildWebView(false);
        mainBridge = new CloudMusicBridge(this, webView, CloudMusicBridge.ROLE_MAIN);
        webView.addJavascriptInterface(mainBridge, "CloudMusicAndroid");
        webView.setWebViewClient(new AppWebViewClient(true));
        webView.setWebChromeClient(new AppChromeClient());
        webContainer.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.requestFocus();
        pageRequested = false;
        // load once the real size is known, so the very first layout already uses the right zoom
        ui.postDelayed(this::loadAppIfNeeded, 600);
    }

    private void updateViewportMetrics() {
        if (root == null) return;
        float density = getResources().getDisplayMetrics().density;
        int w = root.getWidth() - insetLeft - insetRight;
        int h = root.getHeight() - insetTop - insetBottomNoIme;
        if (w <= 0 || h <= 0) return;
        int wDp = Math.round(w / density);
        int hDp = Math.round(h / density);
        if (wDp != viewportWDp || hDp != viewportHDp) {
            viewportWDp = wDp;
            viewportHDp = hDp;
            pushViewport();
        }
        loadAppIfNeeded();
    }

    private void loadAppIfNeeded() {
        if (pageRequested || webView == null) return;
        pageRequested = true;
        webView.loadUrl(APP_URL);
    }

    private void destroyMainWebView() {
        if (mainBridge != null) mainBridge.destroy();
        mainBridge = null;
        if (webView != null) {
            WebView old = webView;
            webView = null;
            webContainer.removeView(old);
            old.stopLoading();
            old.destroy();
        }
    }

    private void recreateMainWebView() {
        Log.w(TAG, "renderer gone, rebuilding the main WebView");
        destroyMainWebView();
        createMainWebView();
    }

    /** Routes every request of the app WebViews (main + overlay). */
    WebResourceResponse route(WebResourceRequest request) {
        Uri uri = request.getUrl();
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return null;
        NetProxy net = CloudMusicApp.get().netProxy();
        if (APP_HOST.equalsIgnoreCase(uri.getHost())) {
            String path = uri.getPath();
            if (path != null && path.startsWith(NetProxy.TUNNEL_PATH)) {
                return net.handleTunnel(path.substring(NetProxy.TUNNEL_PATH.length()));
            }
            return assetServer.serve(path);
        }
        return net.handleSubresource(request);
    }

    final class AppWebViewClient extends WebViewClient {
        private final boolean main;

        AppWebViewClient(boolean main) {
            this.main = main;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                return route(request);
            } catch (Exception e) {
                Log.w(TAG, "request routing failed for " + request.getUrl(), e);
                return null;
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            if (APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
            // electron: setWindowOpenHandler -> shell.openExternal, the app window never navigates away
            openExternal(uri.toString());
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (main && view == webView) {
                ui.post(MainActivity.this::recreateMainWebView);
            } else {
                ui.post(() -> overlayController.onRendererGone(view));
            }
            return true;
        }
    }

    final class AppChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                ownActivityOnTop = true;
                startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
            } catch (ActivityNotFoundException e) {
                ownActivityOnTop = false;
                fileCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            String text = message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")";
            switch (message.messageLevel()) {
                case ERROR:
                    Log.e("CloudMusicWeb", text);
                    break;
                case WARNING:
                    Log.w("CloudMusicWeb", text);
                    break;
                default:
                    Log.d("CloudMusicWeb", text);
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE_DUMP) {
            finishSaveDump(resultCode == RESULT_OK && data != null ? data.getData() : null);
        }
    }

    // ------------------------------------------------- bridge entry points

    void onBridgeReady(CloudMusicBridge bridge) {
        if (bridge != mainBridge) {
            overlayController.onOverlayReady(bridge);
            return;
        }
        overlayController.onMainPageLoaded();
        pushViewport();
        emitWindowState();
    }

    WebViewClient appClient(boolean main) {
        return new AppWebViewClient(main);
    }

    WebChromeClient chromeClient() {
        return new AppChromeClient();
    }

    boolean isPhone() {
        return getResources().getConfiguration().smallestScreenWidthDp < 600;
    }

    float uiScale() {
        return uiScale;
    }

    JSONObject viewportJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("wDp", viewportWDp);
            json.put("hDp", viewportHDp);
            json.put("phone", isPhone());
            json.put("uiScale", (double) uiScale);
        } catch (JSONException ignored) {
            // constant keys
        }
        return json;
    }

    /** cloudmusic-android.js reports the largest pinch factor the layout still fits with. */
    void onViewportApplied(float max) {
        if (Float.isNaN(max) || max <= 0f) return;
        maxUiScale = clamp(max, 1f, MAX_UI_SCALE);
    }

    private void pushViewport() {
        if (mainBridge != null && viewportWDp > 0) mainBridge.emit("android:viewport", viewportJson());
    }

    PoTokenService poTokens() {
        return poTokenService;
    }

    OverlayController overlay() {
        return overlayController;
    }

    /** Hosts invisible helper views (the BotGuard WebView) inside the window. */
    void attachHiddenView(View view) {
        view.setAlpha(0f);
        root.addView(view, 0, new FrameLayout.LayoutParams(1, 1));
    }

    void detachHiddenView(View view) {
        root.removeView(view);
    }

    // window:minimize -> the app keeps running (and playing) in the background
    void minimizeWindow() {
        moveTaskToBack(true);
    }

    // window:toggle-maximize -> immersive fullscreen (system bars hidden)
    void toggleImmersive() {
        immersive = !immersive;
        prefs.edit().putBoolean("immersive", immersive).apply();
        applyImmersive();
        emitWindowState();
    }

    boolean isImmersiveMode() {
        return immersive;
    }

    // window:close -> like closing electron's main window: the whole app ends
    void closeApp() {
        PlaybackService.stop(this);
        overlayController.destroy();
        finishAndRemoveTask();
    }

    private void applyImmersive() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        boolean night = isNightMode();
        controller.setAppearanceLightStatusBars(!night);
        controller.setAppearanceLightNavigationBars(!night);
        if (immersive) controller.hide(WindowInsetsCompat.Type.systemBars());
        else controller.show(WindowInsetsCompat.Type.systemBars());
    }

    private void emitWindowState() {
        if (mainBridge == null) return;
        JSONObject state = new JSONObject();
        try {
            state.put("isMaximized", immersive);
            state.put("isFullScreen", false);
            state.put("isVisible", visible);
        } catch (JSONException ignored) {
            // constant keys
        }
        mainBridge.emit("window:state-changed", state);
    }

    private boolean isNightMode() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    private int backgroundColor() {
        return isNightMode() ? Color.BLACK : Color.rgb(0xe4, 0xe4, 0xe7);
    }

    // touchbar:update-state -> media session / notification + electron's sleep blocker
    void onMediaState(JSONObject state) {
        PlaybackService.update(this, state);
        String status = state.optString("status", "idle");
        boolean playing = status.equals("playing") || status.equals("buffering") || status.equals("loading");
        if (playing != keepScreenOn) {
            keepScreenOn = playing;
            if (playing) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    void dispatchTouchbarAction(JSONObject action) {
        if ("restoreMainWindow".equals(action.optString("type"))) {
            bringToFront();
            return;
        }
        if (mainBridge != null) mainBridge.emit("touchbar:action", action);
    }

    void emitToMain(String channel, Object payload) {
        if (mainBridge != null) mainBridge.emit(channel, payload);
    }

    void bringToFront() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (Exception e) {
            Log.w(TAG, "could not bring cloudmusic to front", e);
        }
    }

    @SuppressWarnings("deprecation")
    void setTaskIcon(String dataUrl) {
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:image/") || comma < 0) return;
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            Bitmap icon = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (icon != null) setTaskDescription(new ActivityManager.TaskDescription(getString(R.string.app_name), icon));
        } catch (Exception e) {
            Log.w(TAG, "set-icon failed", e);
        }
    }

    // dialog:save-dump -> system "save as" dialog (storage access framework)
    void saveDump(JSONObject input, Consumer<JSONObject> callback) {
        if (pendingSaveCallback != null) {
            callback.accept(result(false, null, false, "a save dialog is already open"));
            return;
        }
        String filename = input == null ? "cloudmusic-dump.json" : input.optString("filename", "cloudmusic-dump.json");
        pendingSaveContent = input == null ? "" : input.optString("content", "");
        pendingSaveCallback = callback;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json")
                .putExtra(Intent.EXTRA_TITLE, filename);
        try {
            ownActivityOnTop = true;
            startActivityForResult(intent, REQ_SAVE_DUMP);
        } catch (ActivityNotFoundException e) {
            ownActivityOnTop = false;
            finishSaveDump(null);
        }
    }

    private void finishSaveDump(Uri target) {
        Consumer<JSONObject> callback = pendingSaveCallback;
        String content = pendingSaveContent;
        pendingSaveCallback = null;
        pendingSaveContent = null;
        if (callback == null) return;
        if (target == null) {
            callback.accept(result(false, null, true, null));
            return;
        }
        CloudMusicApp.get().io().execute(() -> {
            JSONObject outcome;
            try (OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                if (out == null) throw new IllegalStateException("cannot open destination");
                out.write((content == null ? "" : content).getBytes(StandardCharsets.UTF_8));
                lastSavedExport = target;
                outcome = result(true, displayName(target), false, null);
            } catch (Exception e) {
                outcome = result(false, null, false, String.valueOf(e));
            }
            JSONObject finalOutcome = outcome;
            ui.post(() -> callback.accept(finalOutcome));
        });
    }

    private static JSONObject result(boolean success, String filePath, boolean canceled, String error) {
        JSONObject json = new JSONObject();
        try {
            json.put("success", success);
            if (filePath != null) json.put("filePath", filePath);
            if (canceled) json.put("canceled", true);
            if (error != null) json.put("error", error);
        } catch (JSONException ignored) {
            // constant keys
        }
        return json;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
            // provider without display names
        }
        return uri.getLastPathSegment() != null ? uri.getLastPathSegment() : uri.toString();
    }

    // shell:open-export-folder / open-downloads
    boolean openExport() {
        try {
            ownActivityOnTop = true;
            if (lastSavedExport != null) {
                Intent view = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(lastSavedExport, "application/json")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(Intent.createChooser(view, getString(R.string.open_export)));
                return true;
            }
            startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void openExternal(String url) {
        try {
            ownActivityOnTop = true;
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, url, Toast.LENGTH_LONG).show();
        }
    }

    void copyToClipboard(String text) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("CloudMusic", text));
    }

    void clearWebViewCache() {
        if (webView != null) webView.clearCache(true);
    }

    // cloudmusic://artist?id=... deeplinks (electron: second-instance / open-url)
    private void handleIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || mainBridge == null) return;
        if ("cloudmusic".equalsIgnoreCase(data.getScheme())) mainBridge.deliverDeeplink(data.toString());
    }

    // ------------------------------------------------------ pinch -> ui scale

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (scaleDetector != null) scaleDetector.onTouchEvent(event);
        if (scaleDetector != null && scaleDetector.isInProgress() && !swallowTouches) {
            swallowTouches = true;
            MotionEvent cancel = MotionEvent.obtain(event);
            cancel.setAction(MotionEvent.ACTION_CANCEL);
            super.dispatchTouchEvent(cancel);
            cancel.recycle();
        }
        if (swallowTouches) {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) swallowTouches = false;
            return true;
        }
        return super.dispatchTouchEvent(event);
    }

    private final class PinchListener extends ScaleGestureDetector.SimpleOnScaleGestureListener {
        @Override
        public boolean onScaleBegin(ScaleGestureDetector detector) {
            pinchStartScale = uiScale;
            pinchFactor = 1f;
            return true;
        }

        @Override
        public boolean onScale(ScaleGestureDetector detector) {
            pinchFactor *= detector.getScaleFactor();
            return true;
        }

        @Override
        public void onScaleEnd(ScaleGestureDetector detector) {
            if (Math.abs(pinchFactor - 1f) < 0.06f) return;
            float next = clamp(Math.round(pinchStartScale * pinchFactor * 20f) / 20f, MIN_UI_SCALE, maxUiScale);
            if (next > maxUiScale - 0.025f) next = maxUiScale;
            if (Math.abs(next - uiScale) < 0.01f) return;
            uiScale = next;
            prefs.edit().putFloat("ui_scale", next).apply();
            pushViewport();
            Toast.makeText(MainActivity.this,
                    getString(R.string.ui_scale_toast, Math.round(next * 100)), Toast.LENGTH_SHORT).show();
        }
    }

    private void maybeShowScaleTip() {
        if (prefs.getBoolean("scale_tip_shown", false)) return;
        prefs.edit().putBoolean("scale_tip_shown", true).apply();
        ui.postDelayed(() -> Toast.makeText(this, R.string.ui_scale_tip, Toast.LENGTH_LONG).show(), 4000);
    }

    private static float clamp(float value, float min, float max) {
        if (Float.isNaN(value)) return 1f;
        return Math.max(min, Math.min(max, value));
    }

}
