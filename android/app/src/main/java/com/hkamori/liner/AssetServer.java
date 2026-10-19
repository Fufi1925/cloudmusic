package com.hkamori.liner;

import android.content.res.AssetManager;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves the packaged renderer (assets/www, built by android/scripts/build-web.mjs)
 * on https://appassets.androidplatform.net/ - the android counterpart of electron's
 * {@code win.loadFile(dist/index.html)}, but on a secure https origin.
 */
final class AssetServer {
    private static final String ROOT = "www";
    private final AssetManager assets;

    AssetServer(AssetManager assets) {
        this.assets = assets;
    }

    WebResourceResponse serve(String path) {
        String clean = normalize(path);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        headers.put("Access-Control-Allow-Origin", "*");
        try {
            InputStream in = assets.open(ROOT + clean);
            String mime = mimeFor(clean);
            String charset = isText(mime) ? "utf-8" : null;
            return new WebResourceResponse(mime, charset, 200, "OK", headers, in);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    static String normalize(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) return "/index.html";
        StringBuilder out = new StringBuilder();
        for (String segment : path.split("/")) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) continue;
            out.append('/').append(segment);
        }
        return out.length() == 0 ? "/index.html" : out.toString();
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
    }

    static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        int dot = p.lastIndexOf('.');
        String ext = dot >= 0 ? p.substring(dot + 1) : "";
        switch (ext) {
            case "html":
            case "htm":
                return "text/html";
            case "js":
            case "mjs":
                return "text/javascript";
            case "css":
                return "text/css";
            case "json":
            case "map":
                return "application/json";
            case "wasm":
                return "application/wasm";
            case "svg":
                return "image/svg+xml";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "avif":
                return "image/avif";
            case "ico":
                return "image/x-icon";
            case "woff2":
                return "font/woff2";
            case "woff":
                return "font/woff";
            case "ttf":
                return "font/ttf";
            case "otf":
                return "font/otf";
            case "mp3":
                return "audio/mpeg";
            case "m4a":
            case "mp4":
                return "audio/mp4";
            case "webm":
                return "audio/webm";
            case "ogg":
            case "opus":
                return "audio/ogg";
            case "wav":
                return "audio/wav";
            case "txt":
                return "text/plain";
            default:
                return "application/octet-stream";
        }
    }
}
