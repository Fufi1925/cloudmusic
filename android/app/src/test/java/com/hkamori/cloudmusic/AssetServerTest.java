package com.hkamori.cloudmusic;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AssetServerTest {
    @Test
    public void normalizesPathsInsideTheBundle() {
        assertEquals("/index.html", AssetServer.normalize("/"));
        assertEquals("/index.html", AssetServer.normalize(null));
        assertEquals("/assets/index-abc.js", AssetServer.normalize("/assets/index-abc.js"));
        assertEquals("/etc/passwd", AssetServer.normalize("/../../etc/passwd"));
        assertEquals("/assets/x.css", AssetServer.normalize("//assets/./x.css"));
    }

    @Test
    public void mimeTypes() {
        assertEquals("text/javascript", AssetServer.mimeFor("/assets/index.js"));
        assertEquals("text/html", AssetServer.mimeFor("/index.html"));
        assertEquals("application/wasm", AssetServer.mimeFor("/x.wasm"));
        assertEquals("image/jpeg", AssetServer.mimeFor("/assets/wallhaven.JPG"));
        assertEquals("application/octet-stream", AssetServer.mimeFor("/blob"));
    }
}
