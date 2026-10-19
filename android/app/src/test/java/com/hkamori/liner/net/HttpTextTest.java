package com.hkamori.liner.net;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class HttpTextTest {
    @Test
    public void webResourceStatusRanges() {
        assertTrue(HttpText.isAllowedWebStatus(200));
        assertTrue(HttpText.isAllowedWebStatus(206));
        assertTrue(HttpText.isAllowedWebStatus(404));
        assertTrue(HttpText.isAllowedWebStatus(599));
        assertFalse(HttpText.isAllowedWebStatus(302));
        assertFalse(HttpText.isAllowedWebStatus(304));
        assertFalse(HttpText.isAllowedWebStatus(99));
        assertFalse(HttpText.isAllowedWebStatus(600));
    }

    @Test
    public void reasonPhraseNeverEmptyAndAscii() {
        assertEquals("OK", HttpText.reason(200, ""));
        assertEquals("Partial Content", HttpText.reason(206, null));
        assertEquals("Custom", HttpText.reason(200, "Custom"));
        assertEquals("Gr??e", HttpText.reason(200, "Größe"));
        assertEquals("Client Error", HttpText.reason(499, " "));
    }

    @Test
    public void sanitizeStripsControlAndNonAscii() {
        assertEquals("a b", HttpText.sanitize("a\nb"));
        assertEquals("caf?", HttpText.sanitize("café"));
        assertEquals("plain", HttpText.sanitize("plain"));
    }

    @Test
    public void mediaTypeSplit() {
        assertArrayEquals(new String[] {"application/json", "utf-8"}, HttpText.mediaType("application/json; charset=utf-8", "x/y"));
        assertArrayEquals(new String[] {"audio/webm", null}, HttpText.mediaType("audio/webm; codecs=\"opus\"", "x/y"));
        assertArrayEquals(new String[] {"x/y", null}, HttpText.mediaType(null, "x/y"));
    }

    @Test
    public void percentEncoding() {
        assertEquals("Not%20Found", HttpText.percentEncode("Not Found"));
        assertEquals("Gr%C3%B6%C3%9Fe", HttpText.percentEncode("Größe"));
    }
}
