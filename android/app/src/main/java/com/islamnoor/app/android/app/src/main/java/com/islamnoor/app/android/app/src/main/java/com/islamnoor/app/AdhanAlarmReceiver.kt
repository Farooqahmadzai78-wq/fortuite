package com.islamnoor.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class PrayerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val serviceIntent = Intent(context, PrayerAudioService::class.java).apply {
            putExtra("eventId", intent.getStringExtra("eventId"))
            putExtra("type", intent.getStringExtra("type"))
            putExtra("prayerName", intent.getStringExtra("prayerName"))
            putExtra("mode", intent.getStringExtra("mode"))
            putExtra("title", intent.getStringExtra("title"))
            putExtra("notifText", intent.getStringExtra("notifText"))
            putExtra("message", intent.getStringExtra("message"))
            putExtra("audioUrl", intent.getStringExtra("audioUrl"))
            putExtra("isArabic", intent.getBooleanExtra("isArabic", false))
            putExtra("vibrate", intent.getBooleanExtra("vibrate", false))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}
