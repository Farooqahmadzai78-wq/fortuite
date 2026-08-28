package com.islamnoor.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject

object AlarmStore {

    private const val PREFS = "prayer_alarms"
    private const val BACKUP = "prayer_alarms_backup"
    private const val DAY_MS = 86400000L
    private const val TAG = "AlarmStore"

    private val handler = Handler(Looper.getMainLooper())
    private var scheduledSinceCancel = 0
    private var restorePending = false

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun backup(ctx: Context) = ctx.getSharedPreferences(BACKUP, Context.MODE_PRIVATE)
    private fun am(ctx: Context) = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun slot(o: JSONObject) =
        o.optString("type") + "|" + o.optString("prayerName")

    fun buildIntent(ctx: Context, o: JSONObject): Intent {
        val i = Intent(ctx, PrayerAlarmReceiver::class.java)
        i.action = "com.islamnoor.app.ALARM." + o.optString("eventId")
        i.putExtra("eventId", o.optString("eventId"))
        i.putExtra("type", o.optString("type"))
        i.putExtra("prayerName", o.optString("prayerName"))
        i.putExtra("mode", o.optString("mode"))
        i.putExtra("title", o.optString("title"))
        i.putExtra("notifText", o.optString("notifText"))
        i.putExtra("message", o.optString("message"))
        i.putExtra("audioUrl", o.optString("audioUrl"))
        i.putExtra("imamId", o.optString("imamId"))
        i.putExtra("isArabic", o.optBoolean("isArabic", false))
        i.putExtra("vibrate", o.optBoolean("vibrate", true))
        return i
    }

    private fun cancelOne(ctx: Context, o: JSONObject) {
        try {
            val pi = PendingIntent.getBroadcast(
                ctx, o.optString("eventId").hashCode(), buildIntent(ctx, o),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            am(ctx).cancel(pi)
            pi.cancel()
        } catch (_: Exception) {}
    }

    private fun dropDuplicates(ctx: Context, o: JSONObject) {
        val key = slot(o)
        val id = o.optString("eventId")
        val snap = HashMap(prefs(ctx).all)
        val ed = prefs(ctx).edit()
        snap.forEach { (k, v) ->
            if (v is String && k != id) {
                try {
                    val old = JSONObject(v)
                    if (slot(old) == key) { cancelOne(ctx, old); ed.remove(k) }
                } catch (_: Exception) {}
            }
        }
        ed.apply()
    }

    fun schedule(ctx: Context, o: JSONObject): Boolean {
        val eventId = o.optString("eventId")
        if (eventId.isEmpty()) return false
        var ts = o.optLong("timestampMs")
        if (ts <= 0L) return false

        val repeat = o.optBoolean("repeat", true)
        val now = System.currentTimeMillis()
        if (ts <= now + 1000L) {
            if (!repeat) { prefs(ctx).edit().remove(eventId).apply(); return false }
            while (ts <= now + 1000L) ts += DAY_MS
        }
        o.put("timestampMs", ts)

        val pi = PendingIntent.getBroadcast(
            ctx, eventId.hashCode(), buildIntent(ctx, o),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        try {
            val alarm = am(ctx)
            val exact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                alarm.canScheduleExactAlarms() else true
            if (exact) alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ts, pi)
            else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ts, pi)
        } catch (e: Exception) {
            Log.w(TAG, "schedule err: " + e); return false
        }

        prefs(ctx).edit().putString(eventId, o.toString()).apply()
        if (repeat) {
            dropDuplicates(ctx, o)
            backup(ctx).edit().putString(slot(o), o.toString()).apply()
            scheduledSinceCancel++
        }
        Log.i(TAG, "arme " + eventId + " @ " + ts)
        return true
    }

    fun rescheduleNextDay(ctx: Context, eventId: String) {
        val raw = prefs(ctx).getString(eventId, null) ?: return
        try {
            val o = JSONObject(raw)
            if (!o.optBoolean("repeat", true)) {
                prefs(ctx).edit().remove(eventId).apply(); return
            }
            o.put("timestampMs", o.optLong("timestampMs") + DAY_MS)
            schedule(ctx, o)
        } catch (e: Exception) { Log.w(TAG, "reschedule err: " + e) }
    }

    fun restoreAll(ctx: Context): Int {
        var n = 0
        HashMap(prefs(ctx).all).forEach { (_, v) ->
            if (v is String) { try { if (schedule(ctx, JSONObject(v))) n++ } catch (_: Exception) {} }
        }
        if (n == 0) {
            HashMap(backup(ctx).all).forEach { (_, v) ->
                if (v is String) { try { if (schedule(ctx, JSONObject(v))) n++ } catch (_: Exception) {} }
            }
        }
        Log.i(TAG, "restore " + n + " alarmes")
        return n
    }

    private fun restoreMissing(ctx: Context) {
        if (!restorePending) return
        restorePending = false
        if (scheduledSinceCancel == 0) {
            Log.i(TAG, "notifications desactivees, pas de restauration")
            return
        }
        val present = HashSet<String>()
        prefs(ctx).all.forEach { (_, v) ->
            if (v is String) { try { present.add(slot(JSONObject(v))) } catch (_: Exception) {} }
        }
        var n = 0
        HashMap(backup(ctx).all).forEach { (k, v) ->
            if (v is String && !present.contains(k)) {
                try { if (schedule(ctx, JSONObject(v))) n++ } catch (_: Exception) {}
            }
        }
        Log.i(TAG, "restoreMissing " + n)
    }

    fun cancelAll(ctx: Context) {
        HashMap(prefs(ctx).all).forEach { (k, v) ->
            try {
                val o = if (v is String) JSONObject(v) else JSONObject().put("eventId", k)
                cancelOne(ctx, o)
            } catch (_: Exception) {}
        }
        prefs(ctx).edit().clear().apply()
        scheduledSinceCancel = 0
        restorePending = true
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ restoreMissing(ctx) }, 6000L)
    }
}
