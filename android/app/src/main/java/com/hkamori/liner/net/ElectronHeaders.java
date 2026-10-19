package com.hkamori.liner.net;

import java.io.IOException;
import java.util.Locale;

import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 1:1 port of electron/main.ts
 * {@code session.defaultSession.webRequest.onBeforeSendHeaders(...)}:
 *
 * <pre>
 * urls: ["*://*.youtube.com/*", "*://*.googlevideo.com/*",
 *        "*://api.music.apple.com/*", "*://amp-api.music.apple.com/*"]
 * </pre>
 *
 * Origin / Referer are replaced with the matching first-party origin and the
 * renderer's {@code x-liner-user-agent} header becomes the real User-Agent.
 * Installed as an OkHttp network interceptor so it runs for every redirect hop,
 * exactly like the electron hook does.
 */
public final class ElectronHeaders implements Interceptor {
    public static final String USER_AGENT_OVERRIDE = "x-liner-user-agent";

    public static boolean matchesFilter(HttpUrl url) {
        String host = url.host().toLowerCase(Locale.ROOT);
        return host.equals("youtube.com")
                || host.endsWith(".youtube.com")
                || host.equals("googlevideo.com")
                || host.endsWith(".googlevideo.com")
                || host.equals("api.music.apple.com")
                || host.equals("amp-api.music.apple.com");
    }

    public static String originFor(String url) {
        if (url.contains("music.apple.com/")) return "https://music.apple.com";
        if (url.contains("://www.youtube.com/")) return "https://www.youtube.com";
        return "https://music.youtube.com";
    }

    public static Request rewrite(Request request) {
        if (!matchesFilter(request.url())) return request;
        String userAgentOverride = request.header(USER_AGENT_OVERRIDE);
        String origin = originFor(request.url().toString());
        Request.Builder builder = request.newBuilder()
                .removeHeader(USER_AGENT_OVERRIDE)
                .removeHeader("Origin")
                .removeHeader("Referer")
                .header("Origin", origin)
                .header("Referer", origin + "/");
        if (userAgentOverride != null && !userAgentOverride.isEmpty()) {
            builder.header("User-Agent", userAgentOverride);
        }
        return builder.build();
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        return chain.proceed(rewrite(chain.request()));
    }
}
