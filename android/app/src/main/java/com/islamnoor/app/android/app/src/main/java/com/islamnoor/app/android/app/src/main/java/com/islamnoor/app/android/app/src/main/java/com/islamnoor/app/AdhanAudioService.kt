package com.islamnoor.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class AdhanAudioService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    companion object { const val CHANNEL_ID = "adhan_channel" }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prayerName = intent?.getStringExtra("prayerName") ?: "Prayer"
        val notifId = intent?.getIntExtra("id", 1) ?: 1
        createChannel()
        startForeground(notifId, NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🕌 $prayerName")
            .setContentText("حان وقت الصلاة")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true).build())
        mediaPlayer = MediaPlayer.create(this, R.raw.adhan)?.apply {
            setOnCompletionListener { stopSelf() }
            start()
        }
        return START_NOT_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Adhan", NotificationManager.IMPORTANCE_HIGH)
            )
        }
    }

    override fun onDestroy() { mediaPlayer?.release(); mediaPlayer = null; super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
