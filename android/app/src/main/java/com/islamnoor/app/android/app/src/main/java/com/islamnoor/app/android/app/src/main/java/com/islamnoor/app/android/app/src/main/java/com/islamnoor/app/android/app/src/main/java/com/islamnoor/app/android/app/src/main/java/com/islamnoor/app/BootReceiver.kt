package com.islamnoor.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Les alarmes seront re-programmées au prochain lancement de l'app
    }
}
