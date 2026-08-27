package com.islamnoor.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        val prefs = context.getSharedPreferences("prayer_alarms", Context.MODE_PRIVATE)
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val now = System.currentTimeMillis()
        val exactOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()

        prefs.all.forEach { (key, value) ->
            if (value !is String) return@forEach
            try {
                val o = JSONObject(value)
                val ts = o.optLong("timestampMs", 0L)
                if (ts <= now) return@forEach

                val i = Intent(context, PrayerAlarmReceiver::class.java).apply {
                    putExtra("eventId", o.optString("eventId", key))
                    putExtra("type", o.optString("type"))
                    putExtra("prayerName", o.optString("prayerName"))
                    putExtra("mode", o.optString("mode"))
                    putExtra("title", o.optString("title"))
                    putExtra("notifText", o.optString("notifText"))
                    putExtra("message", o.optString("notifText"))
                    putExtra("audioUrl", o.optString("audioUrl"))
                    putExtra("isArabic", o.optBoolean("isArabic", false))
                    putExtra("vibrate", o.optBoolean("vibrate", true))
                }
                val pi = PendingIntent.getBroadcast(
                    context, key.hashCode(), i,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                if (exactOk) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ts, pi)
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ts, pi)
                }
            } catch (e: Exception) {
                android.util.Log.w("BootReceiver", "reschedule failed", e)
            }
        }
    }
}
