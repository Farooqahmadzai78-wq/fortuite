package com.islamnoor.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlin.math.abs

class PrayerAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val eventId = intent.getStringExtra("eventId") ?: ("evt_" + System.currentTimeMillis())
        val type = intent.getStringExtra("type") ?: "PRAYER_AZAN"
        val isAzan = type == "PRAYER_AZAN" || type == "adhan"
        val mode = intent.getStringExtra("mode") ?: if (isAzan) "both" else "notification"
        val title = intent.getStringExtra("title") ?: "Islam-Noor"
        val text = intent.getStringExtra("notifText") ?: intent.getStringExtra("message") ?: ""
        val audioUrl = intent.getStringExtra("audioUrl") ?: ""
        val vibrate = intent.getBooleanExtra("vibrate", false)

        NotificationHelper.ensureChannels(context)
        val notifId = safeId(eventId)

        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val contentPi = PendingIntent.getActivity(
            context, notifId, launch ?: Intent(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, NotificationHelper.CHANNEL_ALERTS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(contentPi)
        if (vibrate) builder.setVibrate(longArrayOf(0, 600, 300, 600))

        try {
            NotificationManagerCompat.from(context).notify(notifId, builder.build())
        } catch (e: SecurityException) {
            android.util.Log.w("PrayerAlarmReceiver", "POST_NOTIFICATIONS refuse", e)
        }

        val wantsAudio = isAzan || mode == "audio" || mode == "both"
        if (wantsAudio && audioUrl.isNotEmpty()) {
            val svc = Intent(context, PrayerAudioService::class.java).apply {
                action = PrayerAudioService.ACTION_PLAY
                putExtra("eventId", eventId)
                putExtra("title", title)
                putExtra("text", text)
                putExtra("audioUrl", audioUrl)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(svc)
                } else {
                    context.startService(svc)
                }
            } catch (e: Exception) {
                android.util.Log.e("PrayerAlarmReceiver", "service start failed", e)
            }
        }
    }

    private fun safeId(eventId: String): Int {
        val h = eventId.hashCode()
        return if (h == 0) 1001 else abs(h) % 100000 + 1
    }
}
