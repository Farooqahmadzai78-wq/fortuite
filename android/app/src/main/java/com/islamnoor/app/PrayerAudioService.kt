package com.islamnoor.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class PrayerAudioService : Service() {

    companion object {
        const val ACTION_PLAY = "com.islamnoor.app.PLAY"
        const val ACTION_STOP = "com.islamnoor.app.STOP"
        private const val FGS_ID = 4711
    }

    private var player: MediaPlayer? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        val title = intent?.getStringExtra("title") ?: "Islam-Noor"
        val text = intent?.getStringExtra("text") ?: ""
        val audioUrl = intent?.getStringExtra("audioUrl") ?: ""

        NotificationHelper.ensureChannels(this)
        startForeground(FGS_ID, buildNotification(title, text))

        if (audioUrl.isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }

        acquireWakeLock()
        releasePlayer()

        try {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                setDataSource(audioUrl)
                setOnPreparedListener { it.start() }
                setOnCompletionListener { stopSelf() }
                setOnErrorListener { _, what, extra ->
                    android.util.Log.e("PrayerAudioService", "MediaPlayer $what/$extra")
                    stopSelf()
                    true
                }
                prepareAsync()
            }
        } catch (e: Exception) {
            android.util.Log.e("PrayerAudioService", "setDataSource failed", e)
            stopSelf()
        }

        return START_NOT_STICKY
    }

    private fun buildNotification(title: String, text: String): Notification {
        val stopPi = PendingIntent.getService(
            this, 1,
            Intent(this, PrayerAudioService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val openPi = PendingIntent.getActivity(
            this, 2, launch ?: Intent(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, NotificationHelper.CHANNEL_PLAYBACK)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
            .addAction(0, "Arreter", stopPi)
            .build()
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "islamnoor:adhan")
            wakeLock?.acquire(10 * 60 * 1000L)
        } catch (e: Exception) {
            android.util.Log.w("PrayerAudioService", "wakelock", e)
        }
    }

    private fun releasePlayer() {
        try { player?.reset(); player?.release() } catch (_: Exception) { }
        player = null
    }

    override fun onDestroy() {
        releasePlayer()
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) { }
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
