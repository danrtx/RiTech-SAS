import 'package:firebase_messaging/firebase_messaging.dart';
import '../../../core/config/app_config.dart';

enum PushPermission { granted, provisional, denied, notDetermined }

/// Mensaje recibido, independiente del SDK para poder probar sin Firebase.
class IncomingPush {
  const IncomingPush({required this.data, this.title, this.body});
  final Map<String, Object?> data;
  final String? title;
  final String? body;

  factory IncomingPush.fromRemote(RemoteMessage message) => IncomingPush(
        data: Map<String, Object?>.from(message.data),
        title: message.notification?.title,
        body: message.notification?.body,
      );
}

abstract interface class PushMessagingClient {
  Future<PushPermission> requestPermission();
  Future<String?> getToken();
  Stream<String> get onTokenRefresh;
  Stream<IncomingPush> get onForegroundMessage;
  Stream<IncomingPush> get onMessageOpenedApp;

  /// Mensaje que abrió la app desde estado terminado, si lo hubo.
  Future<IncomingPush?> getInitialMessage();
}

class FirebasePushMessagingClient implements PushMessagingClient {
  FirebasePushMessagingClient([FirebaseMessaging? messaging])
      : _messaging = messaging ?? FirebaseMessaging.instance;
  final FirebaseMessaging _messaging;

  @override
  Future<PushPermission> requestPermission() async {
    final settings = await _messaging.requestPermission();
    return switch (settings.authorizationStatus) {
      AuthorizationStatus.authorized => PushPermission.granted,
      AuthorizationStatus.provisional => PushPermission.provisional,
      AuthorizationStatus.denied ||
      AuthorizationStatus.deniedPermanently =>
        PushPermission.denied,
      AuthorizationStatus.notDetermined => PushPermission.notDetermined,
    };
  }

  // firebase_messaging 17 propone register()/onRegistered, que entregan el
  // Installation ID (FID). El backend suscribe al tópico con el Admin SDK, que
  // requiere el token de registro; se conserva getToken hasta migrar a envío por FID.
  @override
  // ignore: deprecated_member_use
  Future<String?> getToken() => _messaging.getToken(
      vapidKey:
          AppConfig.fcmVapidKey.isEmpty ? null : AppConfig.fcmVapidKey);

  @override
  // ignore: deprecated_member_use
  Stream<String> get onTokenRefresh => _messaging.onTokenRefresh;

  @override
  Stream<IncomingPush> get onForegroundMessage =>
      FirebaseMessaging.onMessage.map(IncomingPush.fromRemote);

  @override
  Stream<IncomingPush> get onMessageOpenedApp =>
      FirebaseMessaging.onMessageOpenedApp.map(IncomingPush.fromRemote);

  @override
  Future<IncomingPush?> getInitialMessage() async {
    final message = await _messaging.getInitialMessage();
    return message == null ? null : IncomingPush.fromRemote(message);
  }
}
