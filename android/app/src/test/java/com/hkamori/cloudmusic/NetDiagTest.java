package com.hkamori.cloudmusic;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** Must match electron/netdiag.ts maskIp and the cloudflare trace parsing in main.ts. */
public class NetDiagTest {
    @Test
    public void masksLikeElectron() {
        assertEquals("203.0.x.x", NetDiag.maskIp("203.0.113.7"));
        assertEquals("2001:db8:x:x", NetDiag.maskIp("2001:db8::1"));
        assertEquals("::x:x", NetDiag.maskIp("::1"));
        assertEquals("x", NetDiag.maskIp("localhost"));
    }

    @Test
    public void cloudflareTrace() {
        String body = "fl=1\nh=cloudflare.com\nip=198.51.100.23\nts=1\nloc=DE\ncolo=FRA\n";
        assertEquals("ip 198.51.x.x · DE", NetDiag.cloudflareDetail(body));
        assertEquals("DE", NetDiag.cloudflareDetail("loc=DE\n"));
        assertNull(NetDiag.cloudflareDetail("nothing"));
    }
}
