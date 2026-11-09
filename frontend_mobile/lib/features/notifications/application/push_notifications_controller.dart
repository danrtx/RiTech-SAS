/// Lógica de las notificaciones push de hedging en la app.
///
/// El controlador pide permiso, registra el dispositivo en el backend, recibe las
/// alertas en los tres estados de la app (primer plano, segundo plano y cerrada) y
/// lleva al usuario al detalle de la orden cuando toca una alerta.
library;

import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/device_registration_api.dart';
import '../data/local_alert_notifier.dart';
import '../data/push_messaging_client.dart';
import '../domain/hedging_alert.dart';

/// En qué punto está la configuración de push del dispositivo.
enum PushStatus {
  /// Firebase no está configurado en este build (sin --dart-define ni archivos nativos).
  disabled,

  /// Pidiendo permiso y registrando el dispositivo.
  initializing,

  /// El usuario no dio permiso de notificaciones: la app funciona sin alertas push.
  permissionDenied,

  /// El backend suscribió el dispositivo al tópico de alertas.
  registered,

  /// No se pudo obtener el token o el backend no respondió; se reintenta solo.
  registrationFailed,
}

/// Estado inmutable que expone [pushNotificationsProvider] a la interfaz.
class PushState {
  const PushState({
    required this.status,
    this.alerts = const {},
    this.lastForegroundAlert,
    this.invalidPayloads = 0,
  });
  final PushStatus status;

  /// Alertas recibidas en esta sesión, por correlationId.
  final Map<String, HedgingAlert> alerts;

  /// Última alerta recibida con la app abierta; [RiTechApp] la muestra como aviso.
  final HedgingAlert? lastForegroundAlert;

  /// Mensajes descartados por no cumplir el contrato (útil para diagnóstico).
  final int invalidPayloads;

  PushState copyWith({
    PushStatus? status,
    Map<String, HedgingAlert>? alerts,
    HedgingAlert? lastForegroundAlert,
    int? invalidPayloads,
  }) =>
      PushState(
        status: status ?? this.status,
        alerts: alerts ?? this.alerts,
        lastForegroundAlert: lastForegroundAlert ?? this.lastForegroundAlert,
        invalidPayloads: invalidPayloads ?? this.invalidPayloads,
      );
}

/// Coordina permisos, registro, recepción y navegación de las alertas push.
///
/// Las dependencias se reciben por constructor para poder reemplazarlas por dobles
/// en las pruebas, sin Firebase ni red.
class PushNotificationsController extends StateNotifier<PushState> {
  PushNotificationsController({
    PushMessagingClient? client,
    required DeviceRegistrationApi registration,
    required LocalAlertNotifier notifier,
  })  : _client = client,
        _registration = registration,
        _notifier = notifier,
        super(PushState(
            status: client == null ? PushStatus.disabled : PushStatus.initializing));

  /// `null` cuando Firebase no está disponible: el controlador queda deshabilitado.
  final PushMessagingClient? _client;
  final DeviceRegistrationApi _registration;
  final LocalAlertNotifier _notifier;
  final List<StreamSubscription<Object?>> _subscriptions = [];

  /// Función de navegación de la UI (GoRouter.go); `null` hasta que la UI esté lista.
  void Function(String route)? _navigate;

  /// Ruta guardada cuando se tocó una alerta antes de que la UI estuviera lista.
  String? _pendingRoute;
  bool _started = false;

  /// Arranca todo el flujo de push. Es idempotente: llamarlo dos veces no duplica nada.
  Future<void> start() async {
    final client = _client;
    if (client == null || _started) return;
    _started = true;
    await _notifier.initialize(_openFromData);
    // Primero se escuchan los eventos, para no perder ninguno mientras se pide permiso.
    _subscriptions
      ..add(client.onForegroundMessage.listen(_onForeground))
      ..add(client.onMessageOpenedApp.listen(_onOpened))
      ..add(client.onTokenRefresh.listen(_register));

    // App abierta desde una notificación estando cerrada (arranque en frío).
    final initial = await client.getInitialMessage();
    if (initial != null) _onOpened(initial);

    final permission = await client.requestPermission();
    if (!mounted) return;
    if (permission == PushPermission.denied ||
        permission == PushPermission.notDetermined) {
      // Sin permiso no se registra el token: la app sigue operando sin alertas push.
      state = state.copyWith(status: PushStatus.permissionDenied);
      return;
    }
    final token = await client.getToken();
    if (token == null) {
      if (mounted) state = state.copyWith(status: PushStatus.registrationFailed);
      return;
    }
    await _register(token);
  }

  /// Envía el token al backend (POST /notifications/devices).
  Future<void> _register(String token) async {
    if (state.status == PushStatus.permissionDenied) return;
    try {
      await _registration.register(token);
      if (mounted) state = state.copyWith(status: PushStatus.registered);
    } catch (_) {
      // Se reintenta con el siguiente onTokenRefresh o al reiniciar la app.
      if (mounted) state = state.copyWith(status: PushStatus.registrationFailed);
    }
  }

  /// Valida el mensaje y, si es correcto, lo guarda en el estado. Devuelve `null` si es inválido.
  HedgingAlert? _accept(IncomingPush push) {
    final alert =
        HedgingAlert.tryParse(push.data, title: push.title, body: push.body);
    if (!mounted) return null;
    if (alert == null) {
      state = state.copyWith(invalidPayloads: state.invalidPayloads + 1);
      return null;
    }
    state = state.copyWith(
        alerts: {...state.alerts, alert.correlationId: alert});
    return alert;
  }

  /// App abierta: FCM no muestra nada por sí solo, así que se publica una notificación local.
  void _onForeground(IncomingPush push) {
    final alert = _accept(push);
    if (alert == null) return;
    state = state.copyWith(lastForegroundAlert: alert);
    // Un fallo al mostrar la notificación local no debe romper la recepción.
    unawaited(_notifier.show(alert).catchError((Object _) {}));
  }

  /// El usuario tocó una notificación: se abre el detalle de la orden.
  void _onOpened(IncomingPush push) {
    final alert = _accept(push);
    if (alert != null) openAlert(alert.correlationId);
  }

  /// Toque sobre una notificación local (las que se muestran en foreground).
  void _openFromData(Map<String, Object?> data) =>
      _onOpened(IncomingPush(data: data));

  /// Navega al detalle; si la UI aún no está lista (arranque en frío) queda pendiente.
  void openAlert(String correlationId) {
    final route = HedgingAlert.routeFor(correlationId);
    final navigate = _navigate;
    if (navigate == null) {
      _pendingRoute = route;
      return;
    }
    navigate(route);
  }

  /// La UI se conecta cuando el router está montado; reproduce la navegación pendiente.
  void attachNavigator(void Function(String route) navigate) {
    _navigate = navigate;
    final pending = _pendingRoute;
    _pendingRoute = null;
    if (pending != null) navigate(pending);
  }

  /// La UI se desmonta: las alertas tocadas a partir de ahora quedan pendientes.
  void detachNavigator() => _navigate = null;

  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    super.dispose();
  }
}

/// `true` solo si FirebaseBootstrap inicializó Firebase en main().
final pushEnabledProvider = Provider<bool>((ref) => false);

/// Cliente de Firebase Messaging, o `null` si push está deshabilitado en este build.
final pushMessagingClientProvider = Provider<PushMessagingClient?>((ref) =>
    ref.watch(pushEnabledProvider) ? FirebasePushMessagingClient() : null);

/// Llamada HTTP al backend para registrar el dispositivo.
final deviceRegistrationApiProvider =
    Provider<DeviceRegistrationApi>((ref) => HttpDeviceRegistrationApi());

/// Notificaciones locales para las alertas recibidas en foreground.
final localAlertNotifierProvider =
    Provider<LocalAlertNotifier>((ref) => FlutterLocalAlertNotifier());

/// Punto de entrada para la UI: crea el controlador y arranca el flujo de push.
/// Las pruebas lo sobrescriben con `overrideWith` para usar dobles.
final pushNotificationsProvider =
    StateNotifierProvider<PushNotificationsController, PushState>((ref) {
  final controller = PushNotificationsController(
    client: ref.watch(pushMessagingClientProvider),
    registration: ref.watch(deviceRegistrationApiProvider),
    notifier: ref.watch(localAlertNotifierProvider),
  );
  unawaited(controller.start());
  return controller;
});
