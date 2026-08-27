package com.islamnoor.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "PrayerScheduler")
class PrayerSchedulerPlugin : Plugin() {

    private fun prefs(): SharedPreferences =
        context.getSharedPreferences("prayer_alarms", Context.MODE_PRIVATE)

    private fun alarmManager(): AlarmManager =
        context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun canExact(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager().canScheduleExactAlarms()

    @PluginMethod
    fun getNativePlatformStatus(call: PluginCall) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        call.resolve(JSObject().apply {
            put("isNativeAndroid", true)
            put("alarmManagerAvailable", true)
            put("sdkVersion", Build.VERSION.SDK_INT)
            put("canScheduleExactAlarms", canExact())
            put("isIgnoringBatteryOptimizations", pm.isIgnoringBatteryOptimizations(context.packageName))
        })
    }

    @PluginMethod
    fun requestNativePermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !canExact()) {
            try {
                val i = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                i.data = Uri.parse("package:" + context.packageName)
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(i)
            } catch (e: Exception) {
                android.util.Log.w("PrayerScheduler", "exact alarm settings", e)
            }
        }
        call.resolve(JSObject().put("canScheduleExactAlarms", canExact()))
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        var requested = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                i.data = Uri.parse("package:" + context.packageName)
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(i)
                requested = true
            } catch (e: Exception) {
                android.util.Log.w("PrayerScheduler", "battery settings", e)
            }
        }
        call.resolve(JSObject().put("requested", requested))
    }

    @PluginMethod
    fun scheduleReminder(call: PluginCall) {
        val eventId = call.getString("eventId") ?: return call.reject("eventId required")
        val timestamp = call.getLong("timestamp") ?: return call.reject("timestamp required")
        val prayerName = call.getString("prayerName") ?: ""
        val mode = call.getString("mode") ?: "notification"
        val title = call.getString("title") ?: "Rappel de priere"
        val notifText = call.getString("notifText") ?: call.getString("message") ?: ""
        val audioUrl = call.getString("audioUrl") ?: ""
        val isArabic = call.getBoolean("isArabic", false) ?: false
        val vibrate = call.getBoolean("vibrate", false) ?: false

        val intent = buildIntent(eventId, "REMINDER_BEFORE_PRAYER", prayerName, mode,
            title, notifText, audioUrl, isArabic, vibrate)
        scheduleExact(eventId, timestamp, intent)
        saveAlarm(eventId, "REMINDER_BEFORE_PRAYER", prayerName, timestamp, mode,
            title, notifText, audioUrl, isArabic, vibrate)
        call.resolve(JSObject().put("success", true).put("eventId", eventId))
    }

    @PluginMethod
    fun scheduleAdhan(call: PluginCall) {
        val eventId = call.getString("eventId") ?: return call.reject("eventId required")
        val timestamp = call.getLong("timestamp") ?: return call.reject("timestamp required")
        val prayerName = call.getString("prayerName") ?: ""
        val title = call.getString("title") ?: "Adhan"
        val message = call.getString("message") ?: ""
        val audioUrl = call.getString("audioUrl") ?: ""
        val vibrate = call.getBoolean("vibrate", false) ?: false

        val intent = buildIntent(eventId, "PRAYER_AZAN", prayerName, "both",
            title, message, audioUrl, false, vibrate)
        intent.putExtra("imamId", call.getString("imamId") ?: "")
        scheduleExact(eventId, timestamp, intent)
        saveAlarm(eventId, "PRAYER_AZAN", prayerName, timestamp, "both",
            title, message, audioUrl, false, vibrate)
        call.resolve(JSObject().put("success", true).put("eventId", eventId))
    }

    @PluginMethod
    fun scheduleTestAlarm(call: PluginCall) {
        val delaySeconds = call.getInt("delaySeconds") ?: 10
        val type = call.getString("type") ?: "adhan"
        val normalized = if (type == "adhan" || type == "PRAYER_AZAN")
            "PRAYER_AZAN" else "REMINDER_BEFORE_PRAYER"
        val prayerName = call.getString("prayerName") ?: "Test"
        val mode = call.getString("mode") ?: "both"
        val title = call.getString("title") ?: "Islam-Noor - Test"
        val notifText = call.getString("notifText") ?: call.getString("message") ?: "Alarme de test"
        val audioUrl = call.getString("audioUrl") ?: ""
        val isArabic = call.getBoolean("isArabic", false) ?: false
        val vibrate = call.getBoolean("vibrate", true) ?: true

        val timestampMs = System.currentTimeMillis() + delaySeconds * 1000L
        val eventId = "test_" + System.currentTimeMillis()

        val intent = buildIntent(eventId, normalized, prayerName, mode,
            title, notifText, audioUrl, isArabic, vibrate)
        scheduleExact(eventId, timestampMs, intent)
        saveAlarm(eventId, normalized, prayerName, timestampMs, mode,
            title, notifText, audioUrl, isArabic, vibrate)

        call.resolve(JSObject().apply {
            put("success", true)
            put("eventId", eventId)
            put("timestampMs", timestampMs)
            put("delaySeconds", delaySeconds)
        })
    }

    @PluginMethod
    fun getPendingAlarms(call: PluginCall) {
        val arr = JSONArray()
        val now = System.currentTimeMillis()
        prefs().all.forEach { (_, v) ->
            if (v is String) {
                try {
                    val o = JSONObject(v)
                    if (o.optLong("timestampMs", 0L) > now) arr.put(o)
                } catch (_: Exception) { }
            }
        }
        call.resolve(JSObject().put("alarmsJson", arr.toString()))
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        val am = alarmManager()
        prefs().all.keys.forEach { key ->
            val pi = PendingIntent.getBroadcast(
                context, key.hashCode(), Intent(context, PrayerAlarmReceiver::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pi != null) { am.cancel(pi); pi.cancel() }
        }
        prefs().edit().clear().apply()
        call.resolve(JSObject().put("cancelled", true))
    }

    private fun buildIntent(eventId: String, type: String, prayerName: String, mode: String,
                            title: String, notifText: String, audioUrl: String,
                            isArabic: Boolean, vibrate: Boolean): Intent {
        return Intent(context, PrayerAlarmReceiver::class.java).apply {
            putExtra("eventId", eventId)
            putExtra("type", type)
            putExtra("prayerName", prayerName)
            putExtra("mode", mode)
            putExtra("title", title)
            putExtra("notifText", notifText)
            putExtra("message", notifText)
            putExtra("audioUrl", audioUrl)
            putExtra("isArabic", isArabic)
            putExtra("vibrate", vibrate)
        }
    }

    private fun scheduleExact(eventId: String, timestampMs: Long, intent: Intent) {
        val am = alarmManager()
        val pi = PendingIntent.getBroadcast(
            context, eventId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        if (canExact()) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestampMs, pi)
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestampMs, pi)
        }
    }

    private fun saveAlarm(eventId: String, type: String, prayerName: String, timestampMs: Long,
                          mode: String, title: String, notifText: String, audioUrl: String,
                          isArabic: Boolean, vibrate: Boolean) {
        val obj = JSONObject().apply {
            put("eventId", eventId)
            put("type", type)
            put("prayerName", prayerName)
            put("timestampMs", timestampMs)
            put("mode", mode)
            put("title", title)
            put("notifText", notifText)
            put("message", notifText)
            put("audioText", notifText)
            put("audioUrl", audioUrl)
            put("isArabic", isArabic)
            put("vibrate", vibrate)
        }
        prefs().edit().putString(eventId, obj.toString()).apply()
    }
}
