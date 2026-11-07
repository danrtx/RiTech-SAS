import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/app.dart';
import 'package:ritech_mobile/core/network/websocket_client.dart';
import 'package:ritech_mobile/core/router/app_router.dart';
import 'package:ritech_mobile/features/chart/presentation/providers/chart_provider.dart';
import 'package:ritech_mobile/features/notifications/application/push_notifications_controller.dart';
import 'package:ritech_mobile/features/notifications/data/device_registration_api.dart';
import 'package:ritech_mobile/features/notifications/data/push_messaging_client.dart';
import 'package:ritech_mobile/features/notifications/presentation/order_detail_screen.dart';
import 'package:ritech_mobile/features/telemetry/presentation/providers/telemetry_provider.dart';
import 'chart_test.dart' show FakeRepository;
import 'push_notifications_test.dart'
    show FakeClient, FakeNotifier, FakeRegistration, payload, settle;
import 'socket_transport_test.dart' show FakeTransport;

class RecordingAdapter implements HttpClientAdapter {
  RequestOptions? request;
  Object? body;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    request = options;
    body = options.data;
    return ResponseBody.fromString(
        jsonEncode({'registered': true}), 201,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType]
        });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  test('registra el token del dispositivo en el backend', () async {
    final adapter = RecordingAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'http://backend.test'))
      ..httpClientAdapter = adapter;
    await HttpDeviceRegistrationApi(dio).register('token-ABCDEFGHIJKLMNOPQRSTU');
    expect(adapter.request!.method, 'POST');
    expect(adapter.request!.uri.toString(),
        'http://backend.test/notifications/devices');
    expect(adapter.body,
        {'token': 'token-ABCDEFGHIJKLMNOPQRSTU', 'platform': 'android'});
  });

  group('RiTechApp con alertas push', () {
    late TelemetryWebSocketClient ws;
    late FakeRepository repo;

    Future<ProviderContainer> pumpApp(
        WidgetTester tester, PushNotificationsController controller) async {
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
      await tester.pumpWidget(UncontrolledProviderScope(
          container: container, child: const RiTechApp()));
      await tester.pumpAndSettle();
      return container;
    }

    testWidgets('foreground: muestra el aviso y "Ver" abre el detalle',
        (tester) async {
      final client = FakeClient();
      final controller = PushNotificationsController(
          client: client,
          registration: FakeRegistration(),
          notifier: FakeNotifier());
      await tester.runAsync(controller.start);
      await pumpApp(tester, controller);
      await tester.runAsync(() async {
        client.foreground.add(IncomingPush(data: payload()));
        await settle();
      });
      await tester.pumpAndSettle();
      expect(find.text('Hedging activado en QQQ: caída rápida'), findsOneWidget);
      await tester.tap(find.text('Ver'));
      await tester.pumpAndSettle();
      expect(find.byType(OrderDetailScreen), findsOneWidget);
      expect(find.text('512.35 USD'), findsOneWidget);
      await tester.tap(find.byTooltip('Volver al tablero'));
      await tester.pumpAndSettle();
      expect(find.byType(OrderDetailScreen), findsNothing);
    });

    testWidgets('arranque desde una notificación abre el detalle tras el primer frame',
        (tester) async {
      final client = FakeClient(initial: IncomingPush(data: payload()));
      final controller = PushNotificationsController(
          client: client,
          registration: FakeRegistration(),
          notifier: FakeNotifier());
      await tester.runAsync(controller.start);
      await pumpApp(tester, controller);
      expect(find.byType(OrderDetailScreen), findsOneWidget);
      expect(find.text('Caída rápida'), findsOneWidget);
    });

    testWidgets('rutas existentes y 404 siguen funcionando', (tester) async {
      final container = await pumpApp(
          tester,
          PushNotificationsController(
              registration: FakeRegistration(), notifier: FakeNotifier()));
      final router = container.read(appRouterProvider);
      router.go('/hedging');
      await tester.pumpAndSettle();
      expect(find.text('Hedging Module Panel'), findsOneWidget);
      router.go('/no-existe');
      await tester.pumpAndSettle();
      expect(find.textContaining('Error 404'), findsOneWidget);
    });
  });
}
