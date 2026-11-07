import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/device_registration_api.dart';
import '../data/local_alert_notifier.dart';
import '../data/push_messaging_client.dart';
import '../domain/hedging_alert.dart';

enum PushStatus {
  /// Firebase no está configurado en este build (sin --dart-define ni archivos nativos).
  disabled,
  initializing,
  permissionDenied,
  registered,
  registrationFailed,
}

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
  final HedgingAlert? lastForegroundAlert;
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

  final PushMessagingClient? _client;
  final DeviceRegistrationApi _registration;
  final LocalAlertNotifier _notifier;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  void Function(String route)? _navigate;
  String? _pendingRoute;
  bool _started = false;

  Future<void> start() async {
    final client = _client;
    if (client == null || _started) return;
    _started = true;
    await _notifier.initialize(_openFromData);
    _subscriptions
      ..add(client.onForegroundMessage.listen(_onForeground))
      ..add(client.onMessageOpenedApp.listen(_onOpened))
      ..add(client.onTokenRefresh.listen(_register));

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

  void _onForeground(IncomingPush push) {
    final alert = _accept(push);
    if (alert == null) return;
    state = state.copyWith(lastForegroundAlert: alert);
    unawaited(_notifier.show(alert).catchError((Object _) {}));
  }

  void _onOpened(IncomingPush push) {
    final alert = _accept(push);
    if (alert != null) openAlert(alert.correlationId);
  }

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

final pushMessagingClientProvider = Provider<PushMessagingClient?>((ref) =>
    ref.watch(pushEnabledProvider) ? FirebasePushMessagingClient() : null);

final deviceRegistrationApiProvider =
    Provider<DeviceRegistrationApi>((ref) => HttpDeviceRegistrationApi());

final localAlertNotifierProvider =
    Provider<LocalAlertNotifier>((ref) => FlutterLocalAlertNotifier());

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
