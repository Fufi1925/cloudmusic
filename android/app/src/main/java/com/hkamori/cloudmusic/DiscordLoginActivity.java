package com.hkamori.cloudmusic;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONTokener;

import java.util.Locale;

/**
 * In-app browser for the Discord login.
 *
 * Opened from Settings -> Discord ("Mit Discord verbinden"). It loads discord.com/login
 * inside a WebView that belongs to CloudMusic, so the login happens inside the app.
 * While the user signs in, the page is polled for the Discord token in localStorage;
 * as soon as it appears the token is handed to {@link DiscordRpc} (encrypted by
 * {@link DiscordTokenStore}) and this activity closes itself.
 *
 * The token is never logged and never leaves the process except to Discord's gateway.
 * Only the token itself is taken over: it is removed from the WebView's localStorage
 * again, so the plain-text copy does not linger on the device.
 */
public final class DiscordLoginActivity extends Activity {
    private static final String TAG = "CloudMusicDiscord";
    private static final String LOGIN_URL = "https://discord.com/login";
    private static final long POLL_INTERVAL_MS = 700L;
    private static final long POLL_TIMEOUT_MS = 10L * 60L * 1000L;

    /** reads the token exactly like the discord web client stores it */
    private static final String READ_TOKEN_JS =
            "(function(){try{var raw=window.localStorage.getItem('token');"
                    + "if(!raw)return null;var value=JSON.parse(raw);"
                    + "if(typeof value!=='string')return null;value=value.trim();"
                    + "if(!/^[A-Za-z0-9._-]{20,199}$/.test(value))return null;"
                    + "return value;}catch(e){return null;}})()";

    /** drops the plain-text copy again once the keystore has it */
    private static final String CLEAR_TOKEN_JS =
            "(function(){try{window.localStorage.removeItem('token');}catch(e){}})()";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView webView;
    private ProgressBar progress;
    private TextView status;
    private boolean captured;
    private boolean finished;
    private long startedAt;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (finished || webView == null) return;
            if (captured) return;
            if (System.currentTimeMillis() - startedAt > POLL_TIMEOUT_MS) {
                setStatus("Zeitüberschreitung – bitte erneut versuchen");
                return;
            }
            readToken();
            ui.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startedAt = System.currentTimeMillis();
        if (isPhone()) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        buildUi();
        loadLogin();
    }

    // --------------------------------------------------------------- ui

    private void buildUi() {
        int barColor = Color.parseColor("#14151A");
        int textColor = Color.parseColor("#F2F3F5");
        int subColor = Color.parseColor("#9AA0A6");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(barColor);

        // top bar: title + close
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(10), dp(8), dp(10));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView title = new TextView(this);
        title.setText("Discord");
        title.setTextColor(textColor);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        TextView subtitle = new TextView(this);
        subtitle.setText("Anmelden – CloudMusic übernimmt das Token automatisch");
        subtitle.setTextColor(subColor);
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
        titles.addView(title);
        titles.addView(subtitle);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextColor(textColor);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        close.setGravity(Gravity.CENTER);
        close.setPadding(dp(14), dp(6), dp(14), dp(6));
        close.setOnClickListener(v -> finishWithoutToken());
        bar.addView(close);

        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        status = new TextView(this);
        status.setTextColor(subColor);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
        status.setPadding(dp(16), 0, dp(16), dp(6));
        status.setVisibility(View.GONE);
        root.addView(status);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        root.addView(progress);

        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(Color.WHITE);
        webView = new WebView(this);
        configureWebView(webView);
        content.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);

        // system bars: keep the bar under the status bar, the page under the nav bar
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            bar.setPadding(dp(16), dp(10) + Math.max(bars.top, cutout.top), dp(8), dp(10));
            int bottom = Math.max(bars.bottom, cutout.bottom);
            if (insets.isVisible(WindowInsetsCompat.Type.ime())) bottom = Math.max(bottom, ime.bottom);
            content.setPadding(0, 0, 0, bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(barColor);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // some sites refuse to render for a plain WebView user agent ("; wv")
        String ua = settings.getUserAgentString();
        if (ua != null && ua.contains("; wv")) {
            settings.setUserAgentString(ua.replace("; wv", ""));
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);

        view.setBackgroundColor(Color.parseColor("#14151A"));
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                // intent://, mailto:, tel:, discord:// -> hand over to the system
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    // nothing installed that can open the link
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                progress.setVisibility(View.GONE);
                showStatus(url);
                readToken();
            }
        });
    }

    private void loadLogin() {
        try {
            webView.loadUrl(LOGIN_URL);
        } catch (Throwable t) {
            setStatus("Login-Seite konnte nicht geladen werden");
        }
        ui.postDelayed(poll, POLL_INTERVAL_MS);
    }

    private void showStatus(String url) {
        if (url == null) return;
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.contains("discord.com/channels") || lower.contains("discord.com/app")
                || lower.contains("discord.com/login?redirect")) {
            setStatus("Angemeldet – Token wird übernommen …");
        } else {
            setStatus(null);
        }
    }

    private void setStatus(String text) {
        if (status == null) return;
        status.setText(text == null ? "" : text);
        status.setVisibility(text == null || text.isEmpty() ? View.GONE : View.VISIBLE);
    }

    // --------------------------------------------------------------- token

    private void readToken() {
        WebView view = webView;
        if (view == null || captured || finished) return;
        view.evaluateJavascript(READ_TOKEN_JS, value -> {
            String token = parseJavascriptString(value);
            if (token != null) capture(token);
        });
    }

    /** evaluateJavascript hands back a JSON encoded value, e.g. "\"abc\"" or "null" */
    private static String parseJavascriptString(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isEmpty() || "null".equals(trimmed)) return null;
        try {
            Object parsed = new JSONTokener(trimmed).nextValue();
            if (!(parsed instanceof String)) return null;
            String token = ((String) parsed).trim();
            if (token.length() < 20 || token.length() >= 200) return null;
            for (int i = 0; i < token.length(); i++) {
                char c = token.charAt(i);
                boolean allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                        || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
                if (!allowed) return null;
            }
            return token;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void capture(String token) {
        if (captured || finished) return;
        captured = true;
        ui.removeCallbacks(poll);
        setStatus("Token übernommen – verbinde mit Discord …");
        try {
            CloudMusicApp.get().discordRpc().setToken(token);
        } catch (Throwable t) {
            Log.w(TAG, "lokal speichern fehlgeschlagen");
            captured = false;
            setStatus("Token konnte nicht gespeichert werden");
            ui.postDelayed(poll, POLL_INTERVAL_MS);
            return;
        }
        // do not keep a plain-text copy in the WebView profile
        try {
            webView.evaluateJavascript(CLEAR_TOKEN_JS, null);
        } catch (Throwable ignored) {
            // page already gone
        }
        Toast.makeText(this, "Mit Discord verbunden", Toast.LENGTH_SHORT).show();
        setResult(RESULT_OK);
        ui.postDelayed(this::finish, 450);
    }

    // --------------------------------------------------------------- lifecycle

    private void finishWithoutToken() {
        if (finished) return;
        finished = true;
        ui.removeCallbacks(poll);
        setResult(RESULT_CANCELED);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        finishWithoutToken();
    }

    @Override
    protected void onDestroy() {
        finished = true;
        ui.removeCallbacksAndMessages(null);
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // --------------------------------------------------------------- helpers

    private boolean isPhone() {
        Configuration config = getResources().getConfiguration();
        return config.smallestScreenWidthDp < 600;
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }
}
