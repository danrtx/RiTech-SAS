import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/core/config/app_config.dart';
import 'package:ritech_mobile/core/network/websocket_client.dart';
import 'package:ritech_mobile/features/telemetry/presentation/providers/telemetry_provider.dart';

void main() {
  group('AppConfig', () {
    test('usa el backend local por defecto', () {
      expect(AppConfig.apiBaseUrl, 'http://localhost:3000');
      expect(AppConfig.wsBaseUrl, 'ws://localhost:3000/telemetry');
    });
  });

  group('TelemetryState', () {
    test('inicia desconectado con NDX como simbolo activo', () {
      const state = TelemetryState(connectionStatus: WebSocketStatus.disconnected);

      expect(state.connectionStatus, WebSocketStatus.disconnected);
      expect(state.activeSymbol, 'NDX');
      expect(state.lastTick, isNull);
    });

    test('copyWith solo cambia los campos indicados', () {
      const state = TelemetryState(connectionStatus: WebSocketStatus.disconnected);
      final updated = state.copyWith(
        connectionStatus: WebSocketStatus.connected,
        lastTick: {'price': 100.5},
      );

      expect(updated.connectionStatus, WebSocketStatus.connected);
      expect(updated.lastTick, {'price': 100.5});
      expect(updated.activeSymbol, 'NDX');
    });
  });

  group('TelemetryWebSocketClient', () {
    test('inicia desconectado', () {
      final client = TelemetryWebSocketClient();
      addTearDown(client.dispose);

      expect(client.status, WebSocketStatus.disconnected);
    });

    test('no envia suscripciones mientras esta desconectado', () {
      final client = TelemetryWebSocketClient();
      addTearDown(client.dispose);

      expect(() => client.subscribeSymbol('qqq'), returnsNormally);
      expect(client.status, WebSocketStatus.disconnected);
    });
  });
}
