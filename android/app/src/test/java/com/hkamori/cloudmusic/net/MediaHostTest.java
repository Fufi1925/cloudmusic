package com.hkamori.cloudmusic.net;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MediaHostTest {
    @Test
    public void audioHostsBypassTheDiskCache() {
        assertTrue(NetProxy.isMediaHost("rr3---sn-nx5e6nle.googlevideo.com"));
        assertTrue(NetProxy.isMediaHost("playback.media-streaming.soundcloud.cloud"));
        assertTrue(NetProxy.isMediaHost("cf-hls-media.sndcdn.com"));
        assertFalse(NetProxy.isMediaHost("i1.sndcdn.com"));
        assertFalse(NetProxy.isMediaHost("lh3.googleusercontent.com"));
        assertFalse(NetProxy.isMediaHost("covers.tryliner.fun"));
    }
}
