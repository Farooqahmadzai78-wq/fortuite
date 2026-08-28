package com.islamnoor.app

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat

class PrayerAudioService : Service() {

    companion object {
        const val ACTION_STOP = "com.islamnoor.app.STOP_ADHAN"
        private const val FG_ID = 424242
        private const val TAG = "PrayerAudio"
    }

    private var player: MediaPlayer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var audioManager: AudioManager? = null
    private var volumeObserver: ContentObserver? = null
    private var volumeReceiver: BroadcastReceiver? = null
    private var startVolume = -1
    private var armed = false
    private val handler = Handler(Looper.getMainLooper())

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {

        if (intent?.action == ACTION_STOP) {
            stopEverything()
            return START_NOT_STICKY
        }

        val isAdhan = intent?.getBooleanExtra("isAdhan", true) ?: true
        val title = intent?.getStringExtra("title") ?: "Islam-Noor"
        val text = intent?.getStringExtra("notifText")
            ?: if (isAdhan) "La priere commence" else "L'heure de la priere approche"
        val audioUrl = intent?.getStringExtra("audioUrl") ?: ""
        val vibrate = intent?.getBooleanExtra("vibrate", true) ?: true

        NotificationHelper.ensureChannels(this)

        val channel = if (isAdhan) NotificationHelper.CHANNEL_ADHAN
                      else NotificationHelper.CHANNEL_REMINDER

        val notif = NotificationHelper
            .build(this, channel, title, text, true, true).build()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(FG_ID, notif,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(FG_ID, notif)
            }
        } catch (e: Exception) {
            Log.w(TAG, "startForeground: " + e)
            NotificationHelper.show(this, FG_ID, channel, title, text)
        }

        if (vibrate) buzz()

        if (audioUrl.isEmpty()) {
            handler.postDelayed({ stopEverything() }, 1500)
            return START_NOT_STICKY
        }

        acquireWake()
        armVolumeStop()
        play(audioUrl)
        return START_NOT_STICKY
    }

    private fun play(url: String) {
        try {
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                setDataSource(url)
                setOnPreparedListener { armed = true; it.start() }
                setOnCompletionListener { stopEverything() }
                setOnErrorListener { _, _, _ -> stopEverything(); true }
                prepareAsync()
            }
            handler.postDelayed({ stopEverything() }, 600000L)
        } catch (e: Exception) {
            Log.e(TAG, "MediaPlayer: " + e)
            stopEverything()
        }
    }

    private fun armVolumeStop() {
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        startVolume = currentVolume()

        volumeObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean) {
                if (!armed) return
                if (currentVolume() != startVolume) stopEverything()
            }
        }
        try {
            contentResolver.registerContentObserver(
                Settings.System.CONTENT_URI, true, volumeObserver!!)
        } catch (_: Exception) {}

        volumeReceiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, i: Intent?) {
                if (armed) stopEverything()
            }
        }
        try {
            val f = IntentFilter("android.media.VOLUME_CHANGED_ACTION")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(volumeReceiver, f, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(volumeReceiver, f)
            }
        } catch (_: Exception) {}
    }

    private fun currentVolume(): Int = try {
        val am = audioManager
        if (am == null) -1 else
            am.getStreamVolume(AudioManager.STREAM_ALARM) * 100 +
            am.getStreamVolume(AudioManager.STREAM_MUSIC)
    } catch (_: Exception) { -1 }

    private fun acquireWake() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "IslamNoor:adhan")
                .also { it.acquire(600000L) }
        } catch (_: Exception) {}
    }

    private fun buzz() {
        try {
            val v: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 200, 400), -1))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(longArrayOf(0, 400, 200, 400), -1)
            }
        } catch (_: Exception) {}
    }

    private fun stopEverything() {
        armed = false
        handler.removeCallbacksAndMessages(null)
        try { player?.let { if (it.isPlaying) it.stop(); it.release() } } catch (_: Exception) {}
        player = null
        try { volumeObserver?.let { contentResolver.unregisterContentObserver(it) } } catch (_: Exception) {}
        volumeObserver = null
        try { volumeReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        volumeReceiver = null
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
        wakeLock = null
        try { NotificationManagerCompat.from(this).cancel(FG_ID) } catch (_: Exception) {}
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}
        stopSelf()
    }

    override fun onDestroy() { stopEverything(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
