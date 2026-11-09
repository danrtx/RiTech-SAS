import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/core/network/websocket_client.dart';
import 'package:ritech_mobile/features/telemetry/presentation/providers/telemetry_provider.dart';

class FakeTransport implements TelemetryTransport {
  final Map<String, List<void Function(Object?)>> _handlers = {};
  bool connected = false;
  final List<Map<String, Object?>> emitted = [];

  @override
  void on(String event, void Function(Object?) callback) {
    _handlers.putIfAbsent(event, () => []).add(callback);
  }

  @override
  void connect() {
    connected = true;
    fire('connect', null);
  }

  @override
  void emit(String event, Map<String, Object?> data) {
    emitted.add({'event': event, ...data});
  }

  @override
  void dispose() {
    connected = false;
  }

  void fire(String event, Object? data) {
    for (final handler in _handlers[event] ?? []) {
      handler(data);
    }
  }
}

void main() {
  group('TelemetryState', () {
    test('estado inicial tiene connectionStatus disconnected', () {
      const state = TelemetryState(
        connectionStatus: WebSocketStatus.disconnected,
      );
      expect(state.connectionStatus, WebSocketStatus.disconnected);
      expect(state.lastTick, isNull);
      expect(state.lastAtr, isNull);
      expect(state.activeSymbol, 'QQQ');
    });

    test('copyWith actualiza campos correctamente', () {
      const state = TelemetryState(
        connectionStatus: WebSocketStatus.disconnected,
      );
      final updated = state.copyWith(
        connectionStatus: WebSocketStatus.connected,
        activeSymbol: 'AAPL',
      );
      expect(updated.connectionStatus, WebSocketStatus.connected);
      expect(updated.activeSymbol, 'AAPL');
    });

    test('copyWith con clearData limpia tick y atr', () {
      final state = const TelemetryState(
        connectionStatus: WebSocketStatus.connected,
      ).copyWith(
        lastTick: {'price': 100.0, 'symbol': 'QQQ'},
        lastAtr: {'atr': 0.5, 'symbol': 'QQQ'},
      );
      expect(state.lastTick, isNotNull);
      expect(state.lastAtr, isNotNull);

      final cleared = state.copyWith(clearData: true);
      expect(cleared.lastTick, isNull);
      expect(cleared.lastAtr, isNull);
    });
  });

  group('TelemetryNotifier', () {
    late FakeTransport transport;
    late TelemetryWebSocketClient client;
    late TelemetryNotifier notifier;

    setUp(() {
      transport = FakeTransport();
      client = TelemetryWebSocketClient(transport: transport);
      notifier = TelemetryNotifier(client);
    });

    tearDown(() {
      notifier.dispose();
      client.dispose();
    });

    test('se conecta al crearse y suscribe al símbolo por defecto', () {
      expect(transport.connected, isTrue);
      expect(
        transport.emitted.any((e) =>
            e['event'] == 'subscribe_symbol' && e['symbol'] == 'QQQ'),
        isTrue,
      );
    });

    test('actualiza estado a connected al conectar', () async {
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.connectionStatus, WebSocketStatus.connected);
    });

    test('switchSymbol cambia el símbolo activo', () {
      notifier.switchSymbol('AAPL');
      expect(notifier.state.activeSymbol, 'AAPL');
    });

    test('switchSymbol al mismo símbolo no cambia estado', () {
      final before = notifier.state;
      notifier.switchSymbol('QQQ');
      expect(identical(notifier.state, before), isTrue);
    });

    test('recibe tick y actualiza lastTick', () async {
      await Future<void>.delayed(Duration.zero);
      transport.fire('telemetry_tick', {
        'symbol': 'QQQ',
        'price': 485.50,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.lastTick, isNotNull);
      expect(notifier.state.lastTick!['price'], 485.50);
    });

    test('ignora tick de otro símbolo', () async {
      await Future<void>.delayed(Duration.zero);
      transport.fire('telemetry_tick', {
        'symbol': 'AAPL',
        'price': 200.0,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.lastTick, isNull);
    });

    test('recibe atr_result y actualiza lastAtr', () async {
      await Future<void>.delayed(Duration.zero);
      transport.fire('atr_result', {
        'symbol': 'QQQ',
        'atr': 0.3456,
        'status': 'ready',
      });
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.lastAtr, isNotNull);
      expect(notifier.state.lastAtr!['atr'], 0.3456);
    });
  });
}
