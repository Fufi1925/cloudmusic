package com.hkamori.cloudmusic;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.ConnectException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NoRouteToHostException;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import com.hkamori.cloudmusic.net.NetProxy;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Port of the "net:diagnose" handler in electron/main.ts (offline dump
 * diagnostics): real dns, tcp:443 and tls handshakes from the device plus the
 * google / cloudflare control endpoints. Result shape = electron/netdiag.ts
 * MainNetResult. Hosts are re-validated exactly like the main process does.
 */
final class NetDiag {
    // electron/netdiag.ts MAIN_NET_HOST_RE / MAIN_NET_MAX_HOSTS
    private static final Pattern HOST = Pattern.compile("^(?=.{1,253}$)[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", Pattern.CASE_INSENSITIVE);
    private static final int MAX_HOSTS = 5;
    private static final int TIMEOUT_MS = 5000;

    private NetDiag() {}

    static JSONObject run(Context context, NetProxy net, JSONArray rawHosts) {
        List<String> hosts = new ArrayList<>();
        if (rawHosts != null) {
            for (int i = 0; i < rawHosts.length() && hosts.size() < MAX_HOSTS; i++) {
                Object value = rawHosts.opt(i);
                if (value instanceof String && HOST.matcher((String) value).matches()) hosts.add((String) value);
            }
        }
        ExecutorService pool = CloudMusicApp.get().io();
        List<Future<JSONObject>> dns = new ArrayList<>();
        List<Future<JSONObject>> tcp = new ArrayList<>();
        List<Future<JSONObject>> tls = new ArrayList<>();
        for (String host : hosts) {
            dns.add(pool.submit(() -> dns(host)));
            tcp.add(pool.submit(() -> tcp(host)));
            tls.add(pool.submit(() -> tls(host)));
        }
        OkHttpClient plain = new OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .callTimeout(6, TimeUnit.SECONDS)
                .build();
        Future<JSONObject> google = pool.submit(() -> control(plain, "google", "https://www.google.com/generate_204", false));
        Future<JSONObject> cloudflare = pool.submit(() -> control(plain, "cloudflare", "https://cloudflare.com/cdn-cgi/trace", true));

        JSONArray resolvers = resolvers(context);
        JSONObject result = new JSONObject();
        try {
            JSONArray dnsArray = collect(dns);
            if (resolvers != null) {
                for (int i = 0; i < dnsArray.length(); i++) dnsArray.getJSONObject(i).put("resolvers", resolvers);
            }
            result.put("dns", dnsArray);
            result.put("tcp", collect(tcp));
            result.put("tls", collect(tls));
            JSONArray controls = new JSONArray();
            controls.put(await(google));
            controls.put(await(cloudflare));
            result.put("controls", controls);
            if (hosts.isEmpty()) {
                result.put("trace", JSONObject.NULL);
            } else {
                // there is no unprivileged traceroute on android; same answer electron gives without the tool
                JSONObject trace = new JSONObject();
                trace.put("host", hosts.get(0));
                trace.put("ok", false);
                trace.put("hops", new JSONArray());
                trace.put("ms", 0);
                trace.put("error", "traceroute not installed");
                result.put("trace", trace);
            }
            String abi = Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown";
            result.put("platform", "android " + Build.VERSION.RELEASE + " " + abi);
        } catch (JSONException ignored) {
            // constant keys
        }
        return result;
    }

    private static JSONArray collect(List<Future<JSONObject>> futures) {
        JSONArray array = new JSONArray();
        for (Future<JSONObject> future : futures) array.put(await(future));
        return array;
    }

    private static JSONObject await(Future<JSONObject> future) {
        try {
            return future.get(20, TimeUnit.SECONDS);
        } catch (Exception e) {
            JSONObject failed = new JSONObject();
            try {
                failed.put("ok", false);
                failed.put("ms", 0);
                failed.put("error", "timed out");
            } catch (JSONException ignored) {
                // constant keys
            }
            return failed;
        }
    }

    private static JSONObject dns(String host) throws JSONException {
        long start = System.currentTimeMillis();
        JSONObject json = new JSONObject().put("host", host);
        try {
            InetAddress address = InetAddress.getByName(host);
            json.put("ok", true).put("addresses", new JSONArray().put(address.getHostAddress()));
        } catch (Exception e) {
            json.put("ok", false).put("error", errorCode(e));
        }
        return json.put("ms", System.currentTimeMillis() - start);
    }

    private static JSONObject tcp(String host) throws JSONException {
        long start = System.currentTimeMillis();
        JSONObject json = new JSONObject().put("host", host).put("port", 443);
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, 443), TIMEOUT_MS);
            json.put("ok", true);
        } catch (Exception e) {
            json.put("ok", false).put("error", errorCode(e));
        }
        return json.put("ms", System.currentTimeMillis() - start);
    }

    // verification off on purpose (like electron): a captive portal or proxy still
    // answers and its untrusted certificate + authorized=false is the evidence
    private static JSONObject tls(String host) throws JSONException {
        long start = System.currentTimeMillis();
        JSONObject json = new JSONObject().put("host", host);
        Socket plain = new Socket();
        try {
            plain.connect(new InetSocketAddress(host, 443), TIMEOUT_MS);
            plain.setSoTimeout(TIMEOUT_MS);
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, new TrustManager[] {new TrustAll()}, null);
            try (SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket(plain, host, 443, true)) {
                socket.startHandshake();
                SSLSession session = socket.getSession();
                Certificate[] chain = session.getPeerCertificates();
                json.put("ok", true);
                json.put("protocol", session.getProtocol());
                json.put("authorized", isTrusted(chain) && HttpsURLConnection.getDefaultHostnameVerifier().verify(host, session));
                if (chain.length > 0 && chain[0] instanceof X509Certificate) {
                    X509Certificate leaf = (X509Certificate) chain[0];
                    String subject = rdn(leaf.getSubjectX500Principal().getName(), "CN");
                    String issuer = rdn(leaf.getIssuerX500Principal().getName(), "O");
                    if (issuer == null) issuer = rdn(leaf.getIssuerX500Principal().getName(), "CN");
                    if (subject != null) json.put("subject", truncate(subject));
                    if (issuer != null) json.put("issuer", truncate(issuer));
                }
            }
        } catch (Exception e) {
            json.put("ok", false).put("error", errorCode(e));
        } finally {
            try {
                plain.close();
            } catch (Exception ignored) {
                // already closed
            }
        }
        return json.put("ms", System.currentTimeMillis() - start);
    }

    private static JSONObject control(OkHttpClient client, String name, String url, boolean cloudflare) throws JSONException {
        long start = System.currentTimeMillis();
        JSONObject json = new JSONObject().put("name", name);
        Request request = new Request.Builder().url(url).header("User-Agent", "cloudmusic-connectivity/1.0").build();
        try (Response response = client.newCall(request).execute()) {
            json.put("ok", response.code() < 400).put("status", response.code());
            if (cloudflare) {
                ResponseBody body = response.body();
                String text = body == null ? "" : body.string();
                if (text.length() > 2048) text = text.substring(0, 2048);
                String detail = cloudflareDetail(text);
                if (detail != null) json.put("detail", detail);
            }
        } catch (Exception e) {
            json.put("ok", false).put("error", errorCode(e));
        }
        return json.put("ms", System.currentTimeMillis() - start);
    }

    // egress fingerprint for support: masked exit ip + colo, nothing else
    static String cloudflareDetail(String body) {
        String ip = line(body, "ip");
        String loc = line(body, "loc");
        if (ip != null) return "ip " + maskIp(ip) + (loc != null ? " · " + loc : "");
        return loc;
    }

    private static String line(String body, String key) {
        Matcher m = Pattern.compile("^" + key + "=(.+)$", Pattern.MULTILINE).matcher(body);
        return m.find() ? m.group(1).trim() : null;
    }

    // electron/netdiag.ts maskIp
    static String maskIp(String ip) {
        if (ip.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+$")) {
            String[] parts = ip.split("\\.");
            return parts[0] + "." + parts[1] + ".x.x";
        }
        if (ip.contains(":")) {
            String[] parts = ip.split(":", -1);
            return parts[0] + ":" + (parts.length > 1 ? parts[1] : "") + ":x:x";
        }
        return "x";
    }

    private static JSONArray resolvers(Context context) {
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return null;
            Network network = cm.getActiveNetwork();
            LinkProperties props = network == null ? null : cm.getLinkProperties(network);
            if (props == null) return null;
            JSONArray list = new JSONArray();
            for (InetAddress dns : props.getDnsServers()) list.put(dns.getHostAddress());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && props.isPrivateDnsActive()) {
                String server = props.getPrivateDnsServerName();
                list.put("private-dns" + (server != null ? ":" + server : ""));
            }
            return list;
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isTrusted(Certificate[] chain) {
        try {
            X509Certificate[] x509 = new X509Certificate[chain.length];
            for (int i = 0; i < chain.length; i++) x509[i] = (X509Certificate) chain[i];
            TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            factory.init((KeyStore) null);
            for (TrustManager manager : factory.getTrustManagers()) {
                if (manager instanceof X509TrustManager) {
                    String authType = x509.length > 0 && "EC".equals(x509[0].getPublicKey().getAlgorithm()) ? "ECDHE_ECDSA" : "ECDHE_RSA";
                    ((X509TrustManager) manager).checkServerTrusted(x509, authType);
                    return true;
                }
            }
        } catch (Exception ignored) {
            // untrusted chain
        }
        return false;
    }

    private static String rdn(String dn, String key) {
        Matcher m = Pattern.compile("(?:^|,)" + key + "=((?:\\\\,|[^,])*)").matcher(dn);
        return m.find() ? m.group(1).replace("\\,", ",") : null;
    }

    private static String truncate(String value) {
        return value.length() > 120 ? value.substring(0, 120) : value;
    }

    // node style error codes, like the electron dump shows them
    private static String errorCode(Exception e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        if (e instanceof UnknownHostException || root instanceof UnknownHostException) return "ENOTFOUND";
        if (e instanceof SocketTimeoutException || root instanceof SocketTimeoutException) return "timed out";
        if (e instanceof NoRouteToHostException) return "EHOSTUNREACH";
        if (e instanceof ConnectException) {
            String message = String.valueOf(e.getMessage()).toUpperCase(Locale.ROOT);
            if (message.contains("ENETUNREACH")) return "ENETUNREACH";
            if (message.contains("ETIMEDOUT")) return "ETIMEDOUT";
            return "ECONNREFUSED";
        }
        String message = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        return message.length() > 120 ? message.substring(0, 120) : message;
    }

    private static final class TrustAll implements X509TrustManager {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
