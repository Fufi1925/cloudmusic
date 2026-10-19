package com.hkamori.liner;

import android.content.Context;
import android.webkit.WebSettings;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The electron app talks to youtube, the liner api and the import sources with a
 * desktop chromium user agent, and BotGuard attestation runs in that same
 * environment. The android build presents the identical desktop chromium UA
 * (with the real engine version of the installed WebView) for every request,
 * in the main WebView, the hidden BotGuard WebView and the native proxy, so all
 * three stay consistent with each other.
 */
public final class UserAgent {
    private static final Pattern CHROME_VERSION = Pattern.compile("Chrome/(\\d+)");
    private static volatile String cached;

    private UserAgent() {}

    public static String get(Context context) {
        String ua = cached;
        if (ua != null) return ua;
        String major = "138";
        try {
            Matcher matcher = CHROME_VERSION.matcher(WebSettings.getDefaultUserAgent(context));
            if (matcher.find()) major = matcher.group(1);
        } catch (Exception ignored) {
            // WebView provider unavailable, keep the fallback version
        }
        ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                + major + ".0.0.0 Safari/537.36";
        cached = ua;
        return ua;
    }
}
