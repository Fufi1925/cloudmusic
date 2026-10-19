package com.hkamori.liner.net;

/** Per-request flags carried through OkHttp (survives redirect follow-ups). */
public final class ProxyTag {
    public static final ProxyTag ANONYMOUS = new ProxyTag(false);
    public static final ProxyTag WITH_CREDENTIALS = new ProxyTag(true);

    /** fetch(..., { credentials: "include" }): send and store WebView cookies. */
    public final boolean withCredentials;

    private ProxyTag(boolean withCredentials) {
        this.withCredentials = withCredentials;
    }
}
