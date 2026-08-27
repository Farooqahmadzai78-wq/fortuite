import { useAdhanNotifications } from '../hooks/useAdhanNotifications';

export function AdhanSetup() {
  // Remplace par les vraies coordonnées de l'utilisateur
  const latitude = 48.8566; // Exemple : Paris
  const longitude = 2.3522;
  
  const { isInitialized, error } = useAdhanNotifications(
    latitude,
    longitude,
    true, // enabled
    10    // rappel 10 min avant
  );

  return (
    <div className="p-4">
      {isInitialized ? (
        <p className="text-green-600">✅ Notifications adhan activées</p>
      ) : error ? (
        <p className="text-red-600">❌ {error}</p>
      ) : (
        <p className="text-gray-500">⏳ Initialisation...</p>
      )}
    </div>
  );
}
