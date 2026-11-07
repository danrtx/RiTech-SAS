class AppConfig {
  static const String marketSymbol = String.fromEnvironment(
    'MARKET_SYMBOL',
    defaultValue: 'QQQ',
  );
  static const String appName = 'RiTech SAS - NASDAQ 100 Hedging';

  // Backend environment URLs (pointing to NestJS backend only)
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );

  static const String wsBaseUrl = String.fromEnvironment(
    'WS_BASE_URL',
    defaultValue: 'http://localhost:3000/telemetry',
  );

  // Firebase / FCM por ambiente. Vacío = push deshabilitado en ese build.
  static const String firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const String firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
  static const String firebaseMessagingSenderId =
      String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const String firebaseProjectId =
      String.fromEnvironment('FIREBASE_PROJECT_ID');
  // Solo web: clave pública VAPID del proyecto Firebase.
  static const String fcmVapidKey = String.fromEnvironment('FCM_VAPID_KEY');
}
