package com.islamnoor.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

object NotificationHelper {
    const val CHANNEL_ALERTS = "nur_prayer_alerts_v1"
    const val CHANNEL_PLAYBACK = "nur_prayer_playback_v1"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return

        val alerts = NotificationChannel(
            CHANNEL_ALERTS,
            "Rappels et Adhan",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Notifications de rappel et d'appel a la priere"
            setSound(null, null)
            enableVibration(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val playback = NotificationChannel(
            CHANNEL_PLAYBACK,
            "Lecture Adhan",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Lecture audio en cours"
            setSound(null, null)
        }

        nm.createNotificationChannel(alerts)
        nm.createNotificationChannel(playback)
    }
}
