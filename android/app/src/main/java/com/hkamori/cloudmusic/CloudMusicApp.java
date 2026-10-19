package com.hkamori.cloudmusic;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import com.hkamori.cloudmusic.net.NetProxy;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/** Process-wide singletons: the native network stack and a worker pool for blocking work. */
public final class CloudMusicApp extends Application {
    public static final String PLAYBACK_CHANNEL_ID = "playback";

    private static CloudMusicApp instance;
    private NetProxy netProxy;
    private DiscordRpc discordRpc;
    private ExecutorService io;

    public static CloudMusicApp get() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        AtomicInteger counter = new AtomicInteger();
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable, "cloudmusic-io-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
        io = Executors.newCachedThreadPool(factory);
        createNotificationChannel();
    }

    public synchronized NetProxy netProxy() {
        if (netProxy == null) netProxy = new NetProxy(this, UserAgent.get(this));
        return netProxy;
    }

    public ExecutorService io() {
        return io;
    }

    /** custom discord rich presence (android gateway client, token kept locally) */
    public synchronized DiscordRpc discordRpc() {
        if (discordRpc == null) {
            discordRpc = new DiscordRpc(this);
            discordRpc.start();
        }
        return discordRpc;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
                PLAYBACK_CHANNEL_ID, getString(R.string.channel_playback), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.channel_playback_description));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        nm.createNotificationChannel(channel);
    }
}
