import { registerPlugin } from '@capacitor/core';
import { Coordinates, CalculationMethod, PrayerTimes } from 'adhan';

interface AdhanPlugin {
  scheduleAdhan(options: { id: number; timestamp: number; prayerName: string }): Promise<void>;
  cancelAll(): Promise<void>;
  checkExactAlarmPermission(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;
}

const Adhan = registerPlugin<AdhanPlugin>('Adhan');

interface PrayerTime {
  name: string;
  time: Date;
  nameAr: string;
}

export class AdhanNotificationService {
  private static PRAYER_IDS = {
    fajr: 1,
    fajrReminder: 10,
    dhuhr: 2,
    dhuhrReminder: 20,
    asr: 3,
    asrReminder: 30,
    maghrib: 4,
    maghribReminder: 40,
    isha: 5,
    ishaReminder: 50,
  };

  static async initialize(latitude: number, longitude: number, reminderMinutes = 10) {
    try {
      // Vérifier les permissions
      const { granted } = await Adhan.checkExactAlarmPermission();
      if (!granted) {
        console.warn('⚠️ Permission alarmes exactes non accordée');
        await Adhan.openExactAlarmSettings();
        return false;
      }

      // Programmer les prières
      await this.scheduleDailyPrayers(latitude, longitude, reminderMinutes);
      console.log('✅ Notifications adhan programmées');
      return true;
    } catch (error) {
      console.error('❌ Erreur initialisation adhan:', error);
      return false;
    }
  }

  private static calculatePrayerTimes(latitude: number, longitude: number): PrayerTime[] {
    const coordinates = new Coordinates(latitude, longitude);
    const date = new Date();
    const params = CalculationMethod.MuslimWorldLeague();
    const prayers = new PrayerTimes(coordinates, date, params);

    return [
      { name: 'fajr', time: prayers.fajr, nameAr: 'الفجر' },
      { name: 'dhuhr', time: prayers.dhuhr, nameAr: 'الظهر' },
      { name: 'asr', time: prayers.asr, nameAr: 'العصر' },
      { name: 'maghrib', time: prayers.maghrib, nameAr: 'المغرب' },
      { name: 'isha', time: prayers.isha, nameAr: 'العشاء' },
    ];
  }

  static async scheduleDailyPrayers(latitude: number, longitude: number, reminderMinutes = 10) {
    const prayerTimes = this.calculatePrayerTimes(latitude, longitude);
    const now = new Date();

    // Annuler anciennes alarmes
    await Adhan.cancelAll();

    for (const prayer of prayerTimes) {
      // Ignorer les prières passées
      if (prayer.time < now) continue;

      // 1) Rappel (X min avant)
      const reminderTime = new Date(prayer.time.getTime() - reminderMinutes * 60 * 1000);
      if (reminderTime > now) {
        await Adhan.scheduleAdhan({
          id: this.PRAYER_IDS[`${prayer.name}Reminder` as keyof typeof this.PRAYER_IDS],
          timestamp: reminderTime.getTime(),
          prayerName: `Rappel ${prayer.nameAr} dans ${reminderMinutes} min`,
        });
      }

      // 2) Adhan (à l'heure exacte)
      await Adhan.scheduleAdhan({
        id: this.PRAYER_IDS[prayer.name as keyof typeof this.PRAYER_IDS],
        timestamp: prayer.time.getTime(),
        prayerName: `${prayer.nameAr} - ${prayer.name}`,
      });
    }

    console.log(`✅ ${prayerTimes.length} prières programmées pour aujourd'hui`);
  }

  static async cancelAllNotifications() {
    await Adhan.cancelAll();
  }
}
