package com.hkamori.cloudmusic.net;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import okhttp3.MediaType;

/** Small HTTP helpers for building android.webkit.WebResourceResponse objects safely. */
final class HttpText {
    private static final Map<Integer, String> REASONS = new HashMap<>();

    static {
        REASONS.put(100, "Continue");
        REASONS.put(200, "OK");
        REASONS.put(201, "Created");
        REASONS.put(202, "Accepted");
        REASONS.put(203, "Non-Authoritative Information");
        REASONS.put(204, "No Content");
        REASONS.put(205, "Reset Content");
        REASONS.put(206, "Partial Content");
        REASONS.put(400, "Bad Request");
        REASONS.put(401, "Unauthorized");
        REASONS.put(402, "Payment Required");
        REASONS.put(403, "Forbidden");
        REASONS.put(404, "Not Found");
        REASONS.put(405, "Method Not Allowed");
        REASONS.put(406, "Not Acceptable");
        REASONS.put(408, "Request Timeout");
        REASONS.put(409, "Conflict");
        REASONS.put(410, "Gone");
        REASONS.put(411, "Length Required");
        REASONS.put(412, "Precondition Failed");
        REASONS.put(413, "Payload Too Large");
        REASONS.put(414, "URI Too Long");
        REASONS.put(415, "Unsupported Media Type");
        REASONS.put(416, "Range Not Satisfiable");
        REASONS.put(418, "I'm a teapot");
        REASONS.put(422, "Unprocessable Entity");
        REASONS.put(425, "Too Early");
        REASONS.put(426, "Upgrade Required");
        REASONS.put(429, "Too Many Requests");
        REASONS.put(451, "Unavailable For Legal Reasons");
        REASONS.put(500, "Internal Server Error");
        REASONS.put(501, "Not Implemented");
        REASONS.put(502, "Bad Gateway");
        REASONS.put(503, "Service Unavailable");
        REASONS.put(504, "Gateway Timeout");
        REASONS.put(505, "HTTP Version Not Supported");
    }

    private HttpText() {}

    /** WebResourceResponse only accepts [100, 299] and [400, 599]; 3xx would mean a redirect. */
    static boolean isAllowedWebStatus(int code) {
        return (code >= 100 && code <= 299) || (code >= 400 && code <= 599);
    }

    /** WebResourceResponse throws on an empty reason phrase. */
    static String reason(int code, String fromServer) {
        String phrase = fromServer == null ? "" : sanitize(fromServer).trim();
        if (!phrase.isEmpty()) return phrase;
        String known = REASONS.get(code);
        if (known != null) return known;
        if (code >= 200 && code < 300) return "OK";
        if (code >= 400 && code < 500) return "Client Error";
        return "Server Error";
    }

    /** Header values / reason phrases must stay single-line printable ASCII. */
    static String sanitize(String value) {
        if (value == null) return "";
        StringBuilder out = null;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            boolean ok = (c >= 0x20 && c < 0x7f) || c == '\t';
            if (!ok) {
                if (out == null) {
                    out = new StringBuilder(value.length());
                    out.append(value, 0, i);
                }
                out.append(c == '\r' || c == '\n' ? ' ' : '?');
            } else if (out != null) {
                out.append(c);
            }
        }
        return out == null ? value : out.toString();
    }

    /** Splits a Content-Type header into {mime, charset} for WebResourceResponse. */
    static String[] mediaType(String contentType, String fallbackMime) {
        if (contentType != null) {
            MediaType parsed = MediaType.parse(contentType);
            if (parsed != null) {
                String mime = (parsed.type() + "/" + parsed.subtype()).toLowerCase(Locale.ROOT);
                String charset = parsed.parameter("charset");
                return new String[] {mime, charset};
            }
        }
        return new String[] {fallbackMime, null};
    }

    static String percentEncode(String value) {
        StringBuilder out = new StringBuilder(value.length() + 8);
        byte[] bytes = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        for (byte b : bytes) {
            int c = b & 0xff;
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '_' || c == '.' || c == '~' || c == ' ') {
                out.append(c == ' ' ? "%20" : String.valueOf((char) c));
            } else {
                out.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
                        .append(Character.toUpperCase(Character.forDigit(c & 15, 16)));
            }
        }
        return out.toString();
    }
}
