import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:ritech_mobile/core/network/websocket_client.dart';
import 'package:ritech_mobile/core/router/app_router.dart';
import 'package:ritech_mobile/features/chart/presentation/providers/chart_provider.dart';
import 'package:ritech_mobile/features/notifications/application/push_notifications_controller.dart';
import 'package:ritech_mobile/features/notifications/data/device_registration_api.dart';
import 'package:ritech_mobile/features/notifications/data/local_alert_notifier.dart';
import 'package:ritech_mobile/features/notifications/data/push_messaging_client.dart';
import 'package:ritech_mobile/features/notifications/domain/hedging_alert.dart';
import 'package:ritech_mobile/features/notifications/presentation/order_detail_screen.dart';
import 'package:ritech_mobile/features/telemetry/presentation/providers/telemetry_provider.dart';
import 'package:ritech_mobile/features/telemetry/presentation/screens/telemetry_dashboard_screen.dart';
import 'chart_test.dart' show FakeRepository;
import 'socket_transport_test.dart' show FakeTransport;

// Pruebas de las notificaciones push: validación del mensaje, flujo del controlador
// (permisos, registro, foreground, background, arranque en frío) y deep link al detalle.
// Firebase, el backend y las notificaciones locales se reemplazan por dobles.

/// Mensaje válido igual al que envía el backend; `overrides` cambia campos puntuales.
Map<String, Object?> payload([Map<String, Object?> overrides = const {}]) => {
      'schemaVersion': '1',
      'type': 'HEDGING_ACTIVATED',
      'correlationId': 'QQQ:1791345600000',
      'symbol': 'QQQ',
      'policy': 'FAST',
      'action': 'STOP_LOSS_REQUEST',
      'price': '512.345',
      'fallPercentPerMinute': '0.75',
      'triggeredAtMs': '1791345600020',
      'route': '/orders/QQQ%3A1791345600000',
      ...overrides,
    };

/// Firebase Messaging falso: los StreamController simulan los eventos de FCM.
class FakeClient implements PushMessagingClient {
  FakeClient({this.permission = PushPermission.granted, this.initial});
  PushPermission permission;
  IncomingPush? initial;
  String? token = 'token-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  final foreground = StreamController<IncomingPush>.broadcast();
  final opened = StreamController<IncomingPush>.broadcast();
  final refresh = StreamController<String>.broadcast();

  @override
  Future<PushPermission> requestPermission() async => permission;
  @override
  Future<String?> getToken() async => token;
  @override
  Stream<String> get onTokenRefresh => refresh.stream;
  @override
  Stream<IncomingPush> get onForegroundMessage => foreground.stream;
  @override
  Stream<IncomingPush> get onMessageOpenedApp => opened.stream;
  @override
  Future<IncomingPush?> getInitialMessage() async => initial;
}

/// Backend falso: guarda los tokens registrados y puede simular una caída con `fail`.
class FakeRegistration implements DeviceRegistrationApi {
  final tokens = <String>[];
  bool fail = false;
  @override
  Future<void> register(String token) async {
    if (fail) throw StateError('backend caído');
    tokens.add(token);
  }
}

/// Notificaciones locales falsas: guarda lo mostrado y permite simular el toque (`onTap`).
class FakeNotifier implements LocalAlertNotifier {
  final shown = <HedgingAlert>[];
  void Function(Map<String, Object?>)? onTap;
  @override
  Future<void> initialize(void Function(Map<String, Object?>) onTap) async =>
      this.onTap = onTap;
  @override
  Future<void> show(HedgingAlert alert) async => shown.add(alert);
}

/// Deja correr las tareas pendientes (eventos de los streams) antes de verificar.
Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  group('HedgingAlert.tryParse', () {
    test('acepta el payload versionado del backend', () {
      final alert = HedgingAlert.tryParse(payload(), title: 't', body: 'b')!;
      expect(alert.correlationId, 'QQQ:1791345600000');
      expect(alert.policy, HedgingPolicy.fast);
      expect(alert.price, 512.345);
      expect(alert.triggeredAt.millisecondsSinceEpoch, 1791345600020);
      expect(alert.route, '/orders/QQQ%3A1791345600000');
      expect(HedgingAlert.tryParse(alert.toData()), isNotNull);
    });

    test('rechaza payloads inválidos o de otra versión', () {
      for (final bad in <Map<String, Object?>>[
        {},
        payload({'schemaVersion': '2'}),
        payload({'type': 'OTHER'}),
        payload({'correlationId': '../../admin'}),
        payload({'correlationId': 'NVDA:1'}),
        payload({'symbol': 'Q Q'}),
        payload({'policy': 'PANIC'}),
        payload({'price': '-1'}),
        payload({'price': 'NaN'}),
        payload({'fallPercentPerMinute': 'abc'}),
        payload({'triggeredAtMs': '1.5'}),
      ]) {
        expect(HedgingAlert.tryParse(bad), isNull, reason: '$bad');
      }
    });

    test('nunca usa la ruta del payload para navegar', () {
      final alert =
          HedgingAlert.tryParse(payload({'route': 'https://malicioso.example'}))!;
      expect(alert.route, '/orders/QQQ%3A1791345600000');
    });
  });

  group('PushNotificationsController', () {
    late FakeClient client;
    late FakeRegistration registration;
    late FakeNotifier notifier;
    PushNotificationsController build() => PushNotificationsController(
        client: client, registration: registration, notifier: notifier);

    setUp(() {
      client = FakeClient();
      registration = FakeRegistration();
      notifier = FakeNotifier();
    });

    test('sin Firebase queda deshabilitado y no registra nada', () async {
      final controller = PushNotificationsController(
          registration: registration, notifier: notifier);
      await controller.start();
      expect(controller.state.status, PushStatus.disabled);
      expect(registration.tokens, isEmpty);
    });

    test('solicita permiso y registra el dispositivo en el backend', () async {
      final controller = build();
      await controller.start();
      expect(controller.state.status, PushStatus.registered);
      expect(registration.tokens, ['token-ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
      client.refresh.add('token-REFRESHED-0123456789');
      await settle();
      expect(registration.tokens.last, 'token-REFRESHED-0123456789');
    });

    test('con permiso denegado no registra token ni falla', () async {
      client.permission = PushPermission.denied;
      final controller = build();
      await controller.start();
      expect(controller.state.status, PushStatus.permissionDenied);
      client.refresh.add('token-REFRESHED-0123456789');
      await settle();
      expect(registration.tokens, isEmpty);
    });

    test('un error del backend deja el estado para reintentar', () async {
      registration.fail = true;
      final controller = build();
      await controller.start();
      expect(controller.state.status, PushStatus.registrationFailed);
      registration.fail = false;
      client.refresh.add('token-REFRESHED-0123456789');
      await settle();
      expect(controller.state.status, PushStatus.registered);
    });

    test('foreground: guarda la alerta y la muestra localmente', () async {
      final controller = build();
      await controller.start();
      client.foreground.add(IncomingPush(data: payload(), title: 'Hedging'));
      await settle();
      expect(notifier.shown.single.correlationId, 'QQQ:1791345600000');
      expect(controller.state.lastForegroundAlert?.title, 'Hedging');
      expect(controller.state.alerts.keys, ['QQQ:1791345600000']);
    });

    test('payload inválido se cuenta y no navega ni notifica', () async {
      final routes = <String>[];
      final controller = build()..attachNavigator(routes.add);
      await controller.start();
      client.foreground.add(IncomingPush(data: payload({'schemaVersion': '9'})));
      client.opened.add(const IncomingPush(data: {'route': '/hedging'}));
      await settle();
      expect(notifier.shown, isEmpty);
      expect(routes, isEmpty);
      expect(controller.state.invalidPayloads, 2);
    });

    test('tocar una alerta en background abre el detalle correcto', () async {
      final routes = <String>[];
      final controller = build()..attachNavigator(routes.add);
      await controller.start();
      client.opened.add(IncomingPush(data: payload()));
      await settle();
      expect(routes, ['/orders/QQQ%3A1791345600000']);
    });

    test('tocar la notificación local navega al detalle', () async {
      final routes = <String>[];
      final controller = build()..attachNavigator(routes.add);
      await controller.start();
      notifier.onTap!(HedgingAlert.tryParse(payload())!.toData());
      expect(routes, ['/orders/QQQ%3A1791345600000']);
    });

    test('arranque en frío: la navegación espera a que la UI esté lista', () async {
      client.initial = IncomingPush(data: payload());
      final controller = build();
      await controller.start();
      final routes = <String>[];
      controller.attachNavigator(routes.add);
      expect(routes, ['/orders/QQQ%3A1791345600000']);
      expect(controller.state.alerts, contains('QQQ:1791345600000'));
    });
  });

  group('deep link /orders/:correlationId', () {
    late TelemetryWebSocketClient ws;
    late FakeRepository repo;

    /// Router real de la app; el tablero inicial usa transportes falsos (sin red).
    Future<GoRouter> pump(
        WidgetTester tester, PushNotificationsController controller) async {
      // Viewport móvil, igual que las pruebas del tablero.
      tester.view.physicalSize = const Size(390, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      ws = TelemetryWebSocketClient(transport: FakeTransport());
      repo = FakeRepository();
      final container = ProviderContainer(overrides: [
        pushNotificationsProvider.overrideWith((ref) => controller),
        telemetryWsClientProvider.overrideWithValue(ws),
        chartProvider
            .overrideWith((ref) => ChartNotifier(repo, ws, polling: false)),
      ]);
      addTearDown(() {
        container.dispose();
        ws.dispose();
        repo.dispose();
      });
      final router = container.read(appRouterProvider);
      await tester.pumpWidget(UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router)));
      await tester.pumpAndSettle();
      return router;
    }

    PushNotificationsController idle() => PushNotificationsController(
        registration: FakeRegistration(), notifier: FakeNotifier());

    testWidgets('muestra el detalle de la alerta recibida', (tester) async {
      final client = FakeClient();
      final controller = PushNotificationsController(
          client: client,
          registration: FakeRegistration(),
          notifier: FakeNotifier());
      await tester.runAsync(() async {
        await controller.start();
        client.foreground.add(IncomingPush(data: payload()));
        await settle();
      });
      final router = await pump(tester, controller);
      router.go('/orders/QQQ%3A1791345600000');
      await tester.pumpAndSettle();
      expect(find.byType(OrderDetailScreen), findsOneWidget);
      expect(find.text('Hedging activado en QQQ'), findsOneWidget);
      expect(find.text('512.35 USD'), findsOneWidget);
      expect(find.text('Caída rápida'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('sin datos de la alerta muestra un estado vacío', (tester) async {
      final router = await pump(tester, idle());
      router.go('/orders/QQQ%3A1');
      await tester.pumpAndSettle();
      expect(find.text('No hay datos de esta alerta en la sesión actual.'),
          findsOneWidget);
    });

    testWidgets('un correlationId malformado redirige al tablero', (tester) async {
      final router = await pump(tester, idle());
      router.go('/orders/..%2F..%2Fadmin');
      await tester.pumpAndSettle();
      expect(find.byType(OrderDetailScreen), findsNothing);
      expect(find.byType(TelemetryDashboardScreen), findsOneWidget);
    });
  });
}
