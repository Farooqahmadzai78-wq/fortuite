package com.islamnoor.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSArray
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

    @PluginMethod
    fun getNativePlatformStatus(call: PluginCall) {
        val am = alarmManager()
        val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            am.canScheduleExactAlarms() else true
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val ignoringBattery = pm.isIgnoringBatteryOptimizations(context.packageName)
        call.resolve(JSObject().apply {
            put("isNativeAndroid", true)
            put("alarmManagerAvailable", true)
            put("sdkVersion", Build.VERSION.SDK_INT)
            put("canScheduleExactAlarms", canExact)
            put("isIgnoringBatteryOptimizations", ignoringBattery)
        })
    }

    @PluginMethod
    fun requestNativePermissions(call: PluginCall) {
        val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!alarmManager().canScheduleExactAlarms()) {
                activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
            }
            alarmManager().canScheduleExactAlarms()
        } else true
        call.resolve(JSObject().put("canScheduleExactAlarms", canExact))
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = android.net.Uri.parse("package:${context.packageName}")
            }
            activity.startActivity(intent)
        }
        call.resolve(JSObject().put("requested", true))
    }

    @PluginMethod
    fun scheduleReminder(call: PluginCall) {
        val eventId = call.getString("eventId") ?: return call.reject("eventId required")
        val timestamp = call.getLong("timestamp") ?: return call.reject("timestamp required")
        val prayerName = call.getString("prayerName") ?: ""
        val mode = call.getString("mode") ?: "notification"
        val title = call.getString("title") ?: "Rappel de prière"
        val notifText = call.getString("notifText") ?: ""
        val audioUrl = call.getString("audioUrl") ?: ""
        val isArabic = call.getBoolean("isArabic", false) ?: false
        val vibrate = call.getBoolean("vibrate", false) ?: false

        val intent = Intent(context, PrayerAlarmReceiver::class.java).apply {
            putExtra("eventId", eventId)
            putExtra("type", "REMINDER_BEFORE_PRAYER")
            putExtra("prayerName", prayerName)
            putExtra("mode", mode)
            putExtra("title", title)
            putExtra("notifText", notifText)
            putExtra("audioUrl", audioUrl)
            putExtra("isArabic", isArabic)
            putExtra("vibrate", vibrate)
        }
        scheduleExact(eventId, timestamp, intent)
        saveAlarm(eventId, "REMINDER_BEFORE_PRAYER", prayerName, timestamp, mode, title, notifText, audioUrl)
        call.resolve(JSObject().put("success", true).put("eventId", eventId))
    }

    @PluginMethod
    fun scheduleAdhan(call: PluginCall) {
        val eventId = call.getString("eventId") ?: return call.reject("eventId required")
        val timestamp = call.getLong("timestamp") ?: return call.reject("timestamp required")
        val prayerName = call.getString("prayerName") ?: ""
        val imamId = call.getString("imamId") ?: ""
        val title = call.getString("title") ?: "Adhan"
        val message = call.getString("message") ?: ""
        val audioUrl = call.getString("audioUrl") ?: ""
        val vibrate = call.getBoolean("vibrate", false) ?: false

        val intent = Intent(context, PrayerAlarmReceiver::class.java).apply {
            putExtra("eventId", eventId)
            putExtra("type", "PRAYER_AZAN")
            putExtra("prayerName", prayerName)
            putExtra("imamId", imamId)
            putExtra("title", title)
            putExtra("message", message)
            putExtra("audioUrl", audioUrl)
            putExtra("vibrate", vibrate)
        }
        scheduleExact(eventId, timestamp, intent)
        saveAlarm(eventId, "PRAYER_AZAN", prayerName, timestamp, "adhan", title, message, audioUrl)
        call.resolve(JSObject().put("success", true).put("eventId", eventId))
    }

    @PluginMethod
    fun scheduleTestAlarm(call: PluginCall) {
        val delaySeconds = call.getInt("delaySeconds") ?: 10
        val type = call.getString("type") ?: "adhan"
        val prayerName = call.getString("prayerName") ?: "Test"
        val mode = call.getString("mode") ?: "both"
        val title = call.getString("title") ?: "Test Alarm"
        val notifText = call.getString("notifText") ?: ""
        val audioUrl = call.getString("audioUrl") ?: ""
        val isArabic = call.getBoolean("isArabic", false) ?: false
        val vibrate = call.getBoolean("vibrate", true) ?: true

        val timestampMs = System.currentTimeMillis() + delaySeconds * 1000L
        val eventId = "test_${System.currentTimeMillis()}"

        val intent = Intent(context, PrayerAlarmReceiver::class.java).apply {
            putExtra("eventId", eventId)
            putExtra("type", type)
            putExtra("prayerName", prayerName)
            putExtra("mode", mode)
            putExtra("title", title)
            putExtra("notifText", notifText)
            putExtra("audioUrl", audioUrl)
            putExtra("isArabic", isArabic)
            putExtra("vibrate", vibrate)
        }
        scheduleExact(eventId, timestampMs, intent)
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
        prefs().all.forEach { (_, v) ->
            if (v is String) {
                try { arr.put(JSONObject(v)) } catch (_: Exception) {}
            }
        }
        call.resolve(JSObject().put("alarmsJson", arr.toString()))
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        val am = alarmManager()
        prefs().all.keys.forEach { key ->
            val id = key.hashCode()
            val pi = PendingIntent.getBroadcast(
                context, id, Intent(context, PrayerAlarmReceiver::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            pi?.let { am.cancel(it) }
        }
        prefs().edit().clear().apply()
        call.resolve(JSObject().put("cancelled", true))
    }

    private fun scheduleExact(eventId: String, timestampMs: Long, intent: Intent) {
        val am = alarmManager()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) return
        val pi = PendingIntent.getBroadcast(
            context, eventId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestampMs, pi)
    }

    private fun saveAlarm(eventId: String, type: String, prayerName: String,
                          timestampMs: Long, mode: String, title: String,
                          notifText: String, audioUrl: String) {
        val obj = JSONObject().apply {
            put("eventId", eventId)
            put("type", type)
            put("prayerName", prayerName)
            put("timestampMs", timestampMs)
            put("mode", mode)
            put("title", title)
            put("notifText", notifText)
            put("audioUrl", audioUrl)
        }
        prefs().edit().putString(eventId, obj.toString()).apply()
    }
}
