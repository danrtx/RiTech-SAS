import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../domain/hedging_alert.dart';

/// Muestra en la bandeja las alertas recibidas con la app en primer plano
/// (en foreground, FCM no despliega la notificación del sistema por sí solo).
abstract interface class LocalAlertNotifier {
  Future<void> initialize(void Function(Map<String, Object?> data) onTap);
  Future<void> show(HedgingAlert alert);
}

class FlutterLocalAlertNotifier implements LocalAlertNotifier {
  FlutterLocalAlertNotifier([FlutterLocalNotificationsPlugin? plugin])
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();
  final FlutterLocalNotificationsPlugin _plugin;

  /// Debe coincidir con `android.notification.channelId` del backend.
  static const channel = AndroidNotificationChannel(
    'hedging_alerts',
    'Alertas de hedging',
    description: 'Activaciones de stop-loss y cobertura del NASDAQ 100',
    importance: Importance.high,
  );

  @override
  Future<void> initialize(void Function(Map<String, Object?> data) onTap) async {
    if (kIsWeb) return;
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        // Los permisos los solicita FirebaseMessaging.requestPermission.
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload == null) return;
        try {
          final decoded = jsonDecode(payload);
          if (decoded is Map<String, Object?>) onTap(decoded);
        } on FormatException {
          // Payload local corrupto: se ignora sin navegar.
        }
      },
    );
    await _plugin
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);
  }

  @override
  Future<void> show(HedgingAlert alert) async {
    if (kIsWeb) return;
    await _plugin.show(
      // Mismo episodio → mismo id: la alerta se reemplaza en lugar de duplicarse.
      id: alert.correlationId.hashCode & 0x7fffffff,
      title: alert.title ?? 'Hedging activado en ${alert.symbol}',
      body: alert.body ??
          '${alert.policy.label}: stop-loss solicitado a ${alert.price.toStringAsFixed(2)} USD',
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(channel.id, channel.name,
            channelDescription: channel.description,
            importance: Importance.high,
            priority: Priority.high),
        iOS: const DarwinNotificationDetails(threadIdentifier: 'hedging'),
      ),
      payload: jsonEncode(alert.toData()),
    );
  }
}
