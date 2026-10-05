class AppConfig {
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
}
