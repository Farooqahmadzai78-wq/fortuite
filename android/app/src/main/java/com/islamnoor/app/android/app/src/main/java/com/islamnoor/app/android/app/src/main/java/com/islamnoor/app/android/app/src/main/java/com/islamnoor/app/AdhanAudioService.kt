package com.islamnoor.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat

class PrayerAudioService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    companion object { const val CHANNEL_ID = "prayer_channel" }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val type = intent?.getStringExtra("type") ?: "PRAYER_AZAN"
        val title = intent?.getStringExtra("title") ?: "Islam-Noor"
        val notifText = intent?.getStringExtra("notifText") ?: intent?.getStringExtra("message") ?: ""
        val audioUrl = intent?.getStringExtra("audioUrl") ?: ""
        val vibrate = intent?.getBooleanExtra("vibrate", false) ?: false

        createChannel()

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(notifText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .build()

        startForeground(startId, notification)

        // Vibration
        if (vibrate) {
            try {
                val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
                } else {
                    @Suppress("DEPRECATION")
                    getSystemService(VIBRATOR_SERVICE) as Vibrator
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(1000, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(1000)
                }
            } catch (e: Exception) {
                android.util.Log.w("PrayerAudioService", "Vibration error: $e")
            }
        }

        // Audio playback
        if (audioUrl.isNotEmpty()) {
            try {
                mediaPlayer = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .build()
                    )
                    setDataSource(audioUrl)
                    setOnPreparedListener { it.start() }
                    setOnCompletionListener { stopSelf() }
                    setOnErrorListener { _, _, _ ->
                        stopSelf()
                        true
                    }
                    prepareAsync()
                }
            } catch (e: Exception) {
                android.util.Log.e("PrayerAudioService", "MediaPlayer error: $e")
                stopSelf()
            }
        } else {
            // Pas d'audio, juste notification
            stopSelf()
        }

        return START_NOT_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Prayer Notifications",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications for prayer times and reminders"
                setSound(null, null) // Audio géré par MediaPlayer
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        mediaPlayer?.release()
        mediaPlayer = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
