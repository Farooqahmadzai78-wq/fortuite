import { useEffect, useState } from 'react';
import { AdhanNotificationService } from '../services/adhanNotifications';

export function useAdhanNotifications(
  latitude: number,
  longitude: number,
  enabled = true,
  reminderMinutes = 10
) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !latitude || !longitude) return;

    const init = async () => {
      try {
        const success = await AdhanNotificationService.initialize(
          latitude,
          longitude,
          reminderMinutes
        );
        setIsInitialized(success);
        if (!success) {
          setError('Permission alarmes non accordée');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      }
    };

    init();
  }, [latitude, longitude, enabled, reminderMinutes]);

  return { isInitialized, error };
}
