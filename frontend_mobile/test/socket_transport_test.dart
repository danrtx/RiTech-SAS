import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/core/network/websocket_client.dart';
import 'package:ritech_mobile/features/telemetry/presentation/providers/telemetry_provider.dart';

class FakeTransport implements TelemetryTransport {
  final Map<String, void Function(Object?)> handlers = {};
  final List<(String, Map<String, Object?>)> sent = [];
  int connects = 0;
  bool disposed = false;
  @override
  void on(String event, void Function(Object?) callback) =>
      handlers[event] = callback;
  @override
  void connect() => connects++;
  @override
  void emit(String event, Map<String, Object?> data) => sent.add((event, data));
  @override
  void dispose() => disposed = true;
  void receive(String event, [Object? value]) => handlers[event]?.call(value);
}

void main() {
  test(
      'connect waits for handshake and restores symbol subscription after reconnect',
      () async {
    final transport = FakeTransport();
    final client = TelemetryWebSocketClient(transport: transport);
    client.subscribeSymbol('ndx');
    client.connect();
    client.connect();
    expect(transport.connects, 1);
    expect(client.status, WebSocketStatus.connecting);
    expect(transport.sent, isEmpty);
    transport.receive('connect');
    expect(client.status, WebSocketStatus.connected);
    expect(transport.sent.single.$1, 'subscribe_symbol');
    expect(transport.sent.single.$2, {'symbol': 'NDX'});
    transport.receive('disconnect');
    transport.receive('connect');
    expect(transport.sent.length, 2);
    client.subscribeSymbol('QQQ');
    expect(transport.sent[2].$1, 'unsubscribe_symbol');
    expect(transport.sent[2].$2, {'symbol': 'NDX'});
    expect(transport.sent[3].$1, 'subscribe_symbol');
    expect(transport.sent[3].$2, {'symbol': 'QQQ'});
    client.dispose();
    client.dispose();
    transport.receive('connect');
    expect(transport.disposed, isTrue);
    expect(client.status, WebSocketStatus.disconnected);
  });
  test(
      'ticks and ATR remain separate; changing symbol clears stale data and ignores old events',
      () async {
    final transport = FakeTransport();
    final client = TelemetryWebSocketClient(transport: transport);
    final notifier = TelemetryNotifier(client);
    notifier.switchSymbol('NDX');
    transport.receive('connect');
    transport.receive('telemetry_tick', {'symbol': 'NDX', 'price': 100});
    transport.receive('atr_result',
        {'symbol': 'NDX', 'atr': 2, 'baseline': 1, 'alert': true});
    transport.receive('telemetry_tick', 'malformed');
    await Future<void>.delayed(Duration.zero);
    expect(notifier.state.lastTick?['price'], 100);
    expect(notifier.state.lastAtr?['atr'], 2);
    notifier.switchSymbol('QQQ');
    expect(notifier.state.lastTick, isNull);
    expect(notifier.state.lastAtr, isNull);
    transport.receive('telemetry_tick', {'symbol': 'NDX', 'price': 200});
    transport.receive('atr_result',
        {'symbol': 'QQQ', 'atr': null, 'status': 'insufficientData'});
    await Future<void>.delayed(Duration.zero);
    expect(notifier.state.lastTick, isNull);
    expect(notifier.state.lastAtr?['status'], 'insufficientData');
    transport.receive('disconnect');
    await Future<void>.delayed(Duration.zero);
    expect(notifier.state.lastAtr, isNull);
    expect(notifier.state.lastTick, isNull);
    notifier.dispose();
    client.dispose();
    transport.receive('telemetry_tick', {'symbol': 'QQQ', 'price': 300});
    await Future<void>.delayed(Duration.zero);
  });
}
