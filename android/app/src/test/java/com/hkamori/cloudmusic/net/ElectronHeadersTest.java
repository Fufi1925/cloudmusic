package com.hkamori.cloudmusic.net;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import okhttp3.HttpUrl;
import okhttp3.Request;
import org.junit.Test;

/** Same rules as electron/main.ts onBeforeSendHeaders. */
public class ElectronHeadersTest {
    private static HttpUrl url(String value) {
        return HttpUrl.get(value);
    }

    @Test
    public void filterMatchesElectronPatterns() {
        assertTrue(ElectronHeaders.matchesFilter(url("https://music.youtube.com/youtubei/v1/player")));
        assertTrue(ElectronHeaders.matchesFilter(url("https://www.youtube.com/sw.js_data")));
        assertTrue(ElectronHeaders.matchesFilter(url("https://youtube.com/")));
        assertTrue(ElectronHeaders.matchesFilter(url("https://rr3---sn-abc.googlevideo.com/videoplayback?x=1")));
        assertTrue(ElectronHeaders.matchesFilter(url("https://api.music.apple.com/v1/catalog")));
        assertTrue(ElectronHeaders.matchesFilter(url("https://amp-api.music.apple.com/v1/me")));
        assertFalse(ElectronHeaders.matchesFilter(url("https://music.apple.com/us/album/x")));
        assertFalse(ElectronHeaders.matchesFilter(url("https://i.ytimg.com/vi/x/hqdefault.jpg")));
        assertFalse(ElectronHeaders.matchesFilter(url("https://api.tryliner.fun/v1/auth/login")));
        assertFalse(ElectronHeaders.matchesFilter(url("https://notyoutube.com/")));
    }

    @Test
    public void originSelection() {
        assertEquals("https://music.apple.com", ElectronHeaders.originFor("https://api.music.apple.com/v1/catalog"));
        assertEquals("https://www.youtube.com", ElectronHeaders.originFor("https://www.youtube.com/youtubei/v1/player"));
        assertEquals("https://music.youtube.com", ElectronHeaders.originFor("https://music.youtube.com/youtubei/v1/browse"));
        assertEquals("https://music.youtube.com", ElectronHeaders.originFor("https://rr1---sn-x.googlevideo.com/videoplayback"));
    }

    @Test
    public void rewritesOriginRefererAndUserAgent() {
        Request in = new Request.Builder()
                .url("https://music.youtube.com/youtubei/v1/player?prettyPrint=false")
                .header("Origin", "file://")
                .header("Referer", "https://appassets.androidplatform.net/")
                .header("User-Agent", "desktop")
                .header("x-cloudmusic-user-agent", "com.google.android.apps.youtube.vr.oculus/1.65.10")
                .header("x-goog-visitor-id", "abc")
                .build();
        Request out = ElectronHeaders.rewrite(in);
        assertEquals("https://music.youtube.com", out.header("Origin"));
        assertEquals("https://music.youtube.com/", out.header("Referer"));
        assertEquals("com.google.android.apps.youtube.vr.oculus/1.65.10", out.header("User-Agent"));
        assertNull(out.header("x-cloudmusic-user-agent"));
        assertEquals("abc", out.header("x-goog-visitor-id"));
        assertEquals(1, out.headers("Origin").size());
    }

    @Test
    public void keepsUserAgentWithoutOverride() {
        Request in = new Request.Builder().url("https://www.youtube.com/sw.js_data").header("User-Agent", "desktop").build();
        Request out = ElectronHeaders.rewrite(in);
        assertEquals("desktop", out.header("User-Agent"));
        assertEquals("https://www.youtube.com", out.header("Origin"));
    }

    @Test
    public void leavesOtherHostsUntouched() {
        Request in = new Request.Builder()
                .url("https://api.tryliner.fun/v1/tracks")
                .header("Origin", "file://")
                .header("x-cloudmusic-user-agent", "kept")
                .build();
        Request out = ElectronHeaders.rewrite(in);
        assertEquals("file://", out.header("Origin"));
        assertEquals("kept", out.header("x-cloudmusic-user-agent"));
    }
}
