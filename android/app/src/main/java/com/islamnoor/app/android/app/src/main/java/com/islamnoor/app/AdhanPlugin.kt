package com.islamnoor.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "Adhan")
class AdhanPlugin : Plugin() {

    @PluginMethod
    fun scheduleAdhan(call: PluginCall) {
        val id = call.getInt("id") ?: return call.reject("id required")
        val timestamp = call.getLong("timestamp") ?: return call.reject("timestamp required")
        val prayerName = call.getString("prayerName") ?: return call.reject("prayerName required")

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            return call.reject("EXACT_ALARM_PERMISSION_DENIED")
        }

        val intent = Intent(context, AdhanAlarmReceiver::class.java).apply {
            putExtra("prayerName", prayerName)
            putExtra("id", id)
        }
        val pi = PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestamp, pi)

        context.getSharedPreferences("adhan_alarms", Context.MODE_PRIVATE)
            .edit().putString("alarm_$id", "$timestamp:$prayerName").apply()

        call.resolve()
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val prefs = context.getSharedPreferences("adhan_alarms", Context.MODE_PRIVATE)

        prefs.all.keys.forEach { key ->
            val id = key.removePrefix("alarm_").toIntOrNull() ?: return@forEach
            val pi = PendingIntent.getBroadcast(
                context, id, Intent(context, AdhanAlarmReceiver::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            pi?.let { alarmManager.cancel(it) }
        }
        prefs.edit().clear().apply()
        call.resolve()
    }

    @PluginMethod
    fun checkExactAlarmPermission(call: PluginCall) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
        } else true
        call.resolve(JSObject().put("granted", granted))
    }

    @PluginMethod
    fun openExactAlarmSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
        }
        call.resolve()
    }
}
