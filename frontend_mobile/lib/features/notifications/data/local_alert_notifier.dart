/// Notificaciones locales para alertas recibidas con la app abierta.
library;

import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../domain/hedging_alert.dart';

/// Muestra en la bandeja las alertas recibidas con la app en primer plano
/// (en foreground, FCM no despliega la notificación del sistema por sí solo).
abstract interface class LocalAlertNotifier {
  /// Prepara el plugin y registra qué hacer cuando el usuario toca la notificación.
  Future<void> initialize(void Function(Map<String, Object?> data) onTap);

  /// Publica la alerta en la bandeja del sistema.
  Future<void> show(HedgingAlert alert);
}

/// Implementación con flutter_local_notifications (Android e iOS; en web no hace nada).
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
      // El payload es el JSON de la alerta (ver show); al tocarla se reconstruye y se navega.
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
    // Android 8+ exige que el canal exista antes de publicar notificaciones en él.
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
