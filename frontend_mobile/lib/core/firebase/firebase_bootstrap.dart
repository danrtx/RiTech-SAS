/// Inicialización de Firebase al arrancar la app y manejador de mensajes en background.
library;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import '../../features/notifications/domain/hedging_alert.dart';
import '../config/app_config.dart';

/// Opciones por ambiente vía --dart-define; nunca se versionan en el repositorio.
FirebaseOptions? firebaseOptionsFromEnvironment() {
  if (AppConfig.firebaseApiKey.isEmpty ||
      AppConfig.firebaseAppId.isEmpty ||
      AppConfig.firebaseMessagingSenderId.isEmpty ||
      AppConfig.firebaseProjectId.isEmpty) {
    return null;
  }
  return const FirebaseOptions(
    apiKey: AppConfig.firebaseApiKey,
    appId: AppConfig.firebaseAppId,
    messagingSenderId: AppConfig.firebaseMessagingSenderId,
    projectId: AppConfig.firebaseProjectId,
  );
}

/// Con la app en background o terminada, el sistema muestra la notificación que
/// envía el backend; aquí solo se valida el payload. El toque se procesa al abrir
/// la app (onMessageOpenedApp / getInitialMessage).
// vm:entry-point evita que el compilador elimine la función: Android la invoca en un
// isolate separado aunque ningún código Dart la llame directamente.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: firebaseOptionsFromEnvironment());
  }
  final alert = HedgingAlert.tryParse(Map<String, Object?>.from(message.data));
  if (alert == null) debugPrint('push_background_invalid_payload');
}

/// Punto único de arranque de Firebase; lo llama main() antes de runApp.
class FirebaseBootstrap {
  /// Devuelve `false` si Firebase no está configurado: la app sigue sin push.
  static Future<bool> initialize() async {
    final options = firebaseOptionsFromEnvironment();
    // En web no hay archivos nativos de configuración: sin opciones no hay push.
    if (options == null && kIsWeb) return false;
    try {
      await Firebase.initializeApp(options: options);
      // Debe registrarse antes de runApp para recibir mensajes con la app cerrada.
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
      return true;
    } catch (error) {
      debugPrint('firebase_init_skipped: ${error.runtimeType}');
      return false;
    }
  }
}
