package com.hkamori.liner.net;

import android.webkit.CookieManager;

import java.io.IOException;
import java.util.List;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Credentialed fetches share the cookie jar with the WebViews (as in electron,
 * where renderer, hidden BotGuard window and main process share one session).
 * Only applied when the renderer asked for {@code credentials: "include"};
 * every other cross-origin fetch from electron's file:// page is cookieless too.
 */
public final class WebCookies implements Interceptor {
    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        ProxyTag tag = request.tag(ProxyTag.class);
        if (tag == null || !tag.withCredentials) return chain.proceed(request);

        String url = request.url().toString();
        CookieManager cookies;
        try {
            cookies = CookieManager.getInstance();
        } catch (Exception e) {
            return chain.proceed(request);
        }
        String cookie = cookies.getCookie(url);
        if (cookie != null && !cookie.isEmpty()) {
            request = request.newBuilder().header("Cookie", cookie).build();
        }
        Response response = chain.proceed(request);
        List<String> setCookies = response.headers("Set-Cookie");
        for (String value : setCookies) cookies.setCookie(url, value);
        return response;
    }
}
