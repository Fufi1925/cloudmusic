package com.hkamori.cloudmusic;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores the Discord user token locally, encrypted with a key that never leaves
 * the Android keystore (AES-256/GCM). The plaintext token exists only in memory
 * while the app is running; it is never written to logs, backups or any network
 * destination other than Discord's own gateway.
 *
 * SharedPreferences holds {"v":1,"iv":"<base64>","ct":"<base64>"} and lives in
 * the app-private data dir (excluded from cloud backup by the manifest flags).
 */
public final class DiscordTokenStore {
    private static final String TAG = "CloudMusicDiscord";
    private static final String PREFS = "cloudmusic_discord_secure";
    private static final String KEY_BLOB = "token_blob";
    private static final String KEY_ALIAS = "cloudmusic_discord_token_v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final int GCM_TAG_BITS = 128;

    private final SharedPreferences prefs;

    DiscordTokenStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized boolean hasToken() {
        String blob = prefs.getString(KEY_BLOB, null);
        return blob != null && !blob.isEmpty();
    }

    synchronized String load() {
        String blob = prefs.getString(KEY_BLOB, null);
        if (blob == null || blob.isEmpty()) return null;
        try {
            JSONObject json = new JSONObject(blob);
            byte[] iv = Base64.decode(json.getString("iv"), Base64.NO_WRAP);
            byte[] ct = Base64.decode(json.getString("ct"), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plain = cipher.doFinal(ct);
            String token = new String(plain, StandardCharsets.UTF_8).trim();
            return token.isEmpty() ? null : token;
        } catch (Throwable t) {
            // key rotated / data corrupted: drop the unreadable blob, the user simply logs in again
            Log.w(TAG, "stored token could not be decrypted, clearing it");
            prefs.edit().remove(KEY_BLOB).apply();
            return null;
        }
    }

    synchronized void save(String token) {
        String trimmed = token == null ? "" : token.trim();
        if (trimmed.isEmpty()) {
            clear();
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] ct = cipher.doFinal(trimmed.getBytes(StandardCharsets.UTF_8));
            JSONObject json = new JSONObject();
            json.put("v", 1);
            json.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
            json.put("ct", Base64.encodeToString(ct, Base64.NO_WRAP));
            prefs.edit().putString(KEY_BLOB, json.toString()).apply();
        } catch (Throwable t) {
            Log.w(TAG, "could not store token securely");
        }
    }

    synchronized void clear() {
        prefs.edit().remove(KEY_BLOB).apply();
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            java.security.Key key = keyStore.getKey(KEY_ALIAS, null);
            if (key instanceof SecretKey) return (SecretKey) key;
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
