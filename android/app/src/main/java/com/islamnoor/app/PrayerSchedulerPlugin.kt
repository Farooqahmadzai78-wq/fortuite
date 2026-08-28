package com.islamnoor.app

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
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

    @PluginMethod
    fun getNativePlatformStatus(call: PluginCall) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            am.canScheduleExactAlarms() else true
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        call.resolve(JSObject().apply {
            put("isNativeAndroid", true)
            put("alarmManagerAvailable", true)
            put("sdkVersion", Build.VERSION.SDK_INT)
            put("canScheduleExactAlarms", canExact)
            put("isIgnoringBatteryOptimizations",
                pm.isIgnoringBatteryOptimizations(context.packageName))
        })
    }

    @PluginMethod
    fun requestNativePermissions(call: PluginCall) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        var ok = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!am.canScheduleExactAlarms()) {
                try {
                    activity.startActivity(
                        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
                } catch (_: Exception) {}
            }
            ok = am.canScheduleExactAlarms()
        }
        call.resolve(JSObject().put("canScheduleExactAlarms", ok))
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                i.data = Uri.parse("package:" + context.packageName)
                activity.startActivity(i)
            } catch (_: Exception) {}
        }
        call.resolve(JSObject().put("requested", true))
    }

    @PluginMethod
    fun scheduleReminder(call: PluginCall) {
        val eventId = call.getString("eventId") ?: return call.reject("eventId required")
        val ts = call.getLong("timestamp") ?: return call.reject("timestamp required")
        val o = JSONObject()
        o.put("eventId", eventId)
        o.put("timestampMs", ts)
        o.put("type", "REMINDER_BEFORE_PRAYER")
        o.put("prayerName", call.getString("prayerName") ?: "")
        o.put("mode", call.getString("mode") ?: "notification")
        o.put("title", call.getString("title") ?: "Islam-Noor")
        o.put("notifText", call.getString("notifText") ?: "")
        o.put("message", call.getString("message") ?: "")
        o.put("audioUrl", call.getString("audioUrl") ?: "")
        o.put("isArabic", call.getBoolean("isArabic", false) ?: false)
        o.put("vibrate", call.getBoolean("vibrate", true) ?: true)
        o.put("repeat", true)
        val ok = AlarmStore.schedule(context, o)
        call.resolve(JSObject().put("success", ok).put("eventId", eventId))
    }

    @PluginMethod
    fun scheduleAdhan(call: PluginCall) {
        val eventId = call.getString("eventId") ?: return call.reject("eventId required")
        val ts = call.getLong("timestamp") ?: return call.reject("timestamp required")
        val o = JSONObject()
        o.put("eventId", eventId)
        o.put("timestampMs", ts)
        o.put("type", "PRAYER_AZAN")
        o.put("prayerName", call.getString("prayerName") ?: "")
        o.put("imamId", call.getString("imamId") ?: "")
        o.put("mode", "both")
        o.put("title", call.getString("title") ?: "Islam-Noor")
        o.put("notifText", call.getString("message") ?: "La priere commence")
        o.put("message", call.getString("message") ?: "")
        o.put("audioUrl", call.getString("audioUrl") ?: "")
        o.put("vibrate", call.getBoolean("vibrate", true) ?: true)
        o.put("repeat", true)
        val ok = AlarmStore.schedule(context, o)
        call.resolve(JSObject().put("success", ok).put("eventId", eventId))
    }

    @PluginMethod
    fun scheduleTestAlarm(call: PluginCall) {
        val delay = call.getInt("delaySeconds") ?: 10
        val ts = System.currentTimeMillis() + delay * 1000L
        val eventId = "test_" + System.currentTimeMillis()
        val type = call.getString("type") ?: "adhan"
        val isAdhan = type == "adhan" || type == "PRAYER_AZAN"
        val o = JSONObject()
        o.put("eventId", eventId)
        o.put("timestampMs", ts)
        o.put("type", if (isAdhan) "PRAYER_AZAN" else "REMINDER_BEFORE_PRAYER")
        o.put("prayerName", call.getString("prayerName") ?: "Test")
        o.put("mode", call.getString("mode") ?: "both")
        o.put("title", call.getString("title") ?: "Islam-Noor")
        o.put("notifText", call.getString("notifText")
            ?: call.getString("message") ?: "Test")
        o.put("message", call.getString("message") ?: "")
        o.put("audioUrl", call.getString("audioUrl") ?: "")
        o.put("isArabic", call.getBoolean("isArabic", false) ?: false)
        o.put("vibrate", call.getBoolean("vibrate", true) ?: true)
        o.put("repeat", false)
        val ok = AlarmStore.schedule(context, o)
        call.resolve(JSObject().apply {
            put("success", ok)
            put("eventId", eventId)
            put("timestampMs", ts)
            put("delaySeconds", delay)
        })
    }

    @PluginMethod
    fun getPendingAlarms(call: PluginCall) {
        val arr = JSONArray()
        AlarmStore.prefs(context).all.forEach { (_, v) ->
            if (v is String) {
                try { arr.put(JSONObject(v)) } catch (_: Exception) {}
            }
        }
        call.resolve(JSObject().put("alarmsJson", arr.toString()))
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        AlarmStore.cancelAll(context)
        call.resolve(JSObject().put("cancelled", true))
    }
}
