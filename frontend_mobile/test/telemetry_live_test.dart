import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/core/network/websocket_client.dart';

void main() {
  const url = String.fromEnvironment('TELEMETRY_TEST_URL');
  test('real Dart Socket.IO transport receives backend ticks and latest ATR',
      () async {
    final client = TelemetryWebSocketClient(transport: SocketIoTransport(url));
    final tick =
        client.messagesStream.first.timeout(const Duration(seconds: 10));
    final atr = client.atrStream.first.timeout(const Duration(seconds: 10));
    try {
      client.subscribeSymbol('NDX');
      client.connect();
      final received = await Future.wait([tick, atr]);
      expect(received[0]['symbol'], 'NDX');
      expect(received[0]['price'], isA<num>());
      expect(received[0]['eventTime'], isA<num>());
      expect(received[0]['receivedAt'], isA<num>());
      expect(received[1]['status'], 'ready');
      expect(received[1]['atr'], isA<num>());
      expect(client.status, WebSocketStatus.connected);
    } finally {
      client.dispose();
    }
  },
      skip:
          url.isEmpty ? 'Run backend npm run smoke:local -- --flutter' : false);
}
