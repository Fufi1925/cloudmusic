package com.hkamori.cloudmusic;

import android.content.Context;

import com.hkamori.cloudmusic.net.NetProxy;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.Locale;

/**
 * storage:get-cache-stats. Electron sums the chromium profile folders below
 * userData ("Cache", "Code Cache", "Service Worker", "IndexedDB", "Local Storage",
 * "blob_storage"); the android WebView keeps the very same chromium folders,
 * split between cacheDir/WebView and dataDir/app_webview. The native http cache
 * of the proxy counts as http cache.
 */
final class CacheStats {
    private static final int MAX_DEPTH = 6;

    private long http;
    private long code;
    private long serviceWorker;
    private long indexedDb;
    private long localStorage;
    private long blob;

    private CacheStats() {}

    static JSONObject compute(Context context, NetProxy net) {
        CacheStats stats = new CacheStats();
        File cacheDir = context.getCacheDir();
        File dataDir = context.getDataDir();
        stats.walk(new File(cacheDir, "WebView"), 0);
        stats.walk(new File(dataDir, "app_webview"), 0);
        stats.http += net.cacheSize();

        JSONObject json = new JSONObject();
        try {
            json.put("cacheSize", stats.http + stats.code);
            json.put("httpCacheSize", stats.http);
            json.put("codeCacheSize", stats.code);
            json.put("serviceWorkerSize", stats.serviceWorker);
            json.put("indexedDbSize", stats.indexedDb);
            json.put("localStorageSize", stats.localStorage);
            json.put("blobStorageSize", stats.blob);
            json.put("cachePath", cacheDir.getAbsolutePath());
        } catch (JSONException ignored) {
            // constant keys
        }
        return json;
    }

    private void walk(File dir, int depth) {
        if (dir == null || depth > MAX_DEPTH || !dir.isDirectory()) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (!child.isDirectory()) continue;
            String name = child.getName().toLowerCase(Locale.ROOT);
            switch (name) {
                case "http cache":
                case "cache":
                    http += size(child, 0);
                    break;
                case "code cache":
                case "gpucache":
                case "shadercache":
                    code += size(child, 0);
                    break;
                case "service worker":
                    serviceWorker += size(child, 0);
                    break;
                case "indexeddb":
                    indexedDb += size(child, 0);
                    break;
                case "local storage":
                    localStorage += size(child, 0);
                    break;
                case "blob_storage":
                    blob += size(child, 0);
                    break;
                default:
                    walk(child, depth + 1);
            }
        }
    }

    private static long size(File file, int depth) {
        if (file == null || depth > 32) return 0;
        if (file.isFile()) return file.length();
        File[] children = file.listFiles();
        if (children == null) return 0;
        long total = 0;
        for (File child : children) total += size(child, depth + 1);
        return total;
    }
}
