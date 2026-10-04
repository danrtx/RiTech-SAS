import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config/app_config.dart';

enum WebSocketStatus { disconnected, connecting, connected }

class TelemetryWebSocketClient {
  WebSocketChannel? _channel;
  final StreamController<Map<String, dynamic>> _messagesController =
      StreamController<Map<String, dynamic>>.broadcast();

  final StreamController<WebSocketStatus> _statusController =
      StreamController<WebSocketStatus>.broadcast();

  Stream<Map<String, dynamic>> get messagesStream => _messagesController.stream;
  Stream<WebSocketStatus> get statusStream => _statusController.stream;

  WebSocketStatus _currentStatus = WebSocketStatus.disconnected;
  WebSocketStatus get status => _currentStatus;

  void connect() {
    if (_currentStatus == WebSocketStatus.connected) return;

    _updateStatus(WebSocketStatus.connecting);

    try {
      final uri = Uri.parse(AppConfig.wsBaseUrl);
      _channel = WebSocketChannel.connect(uri);
      _updateStatus(WebSocketStatus.connected);

      _channel!.stream.listen(
        (data) {
          try {
            final decoded = jsonDecode(data as String) as Map<String, dynamic>;
            _messagesController.add(decoded);
          } catch (e) {
            // Error decoding message payload
          }
        },
        onError: (error) {
          _handleDisconnect();
        },
        onDone: () {
          _handleDisconnect();
        },
      );
    } catch (e) {
      _handleDisconnect();
    }
  }

  void subscribeSymbol(String symbol) {
    if (_currentStatus != WebSocketStatus.connected) return;
    final payload = jsonEncode({
      'event': 'subscribe_symbol',
      'data': {'symbol': symbol.toUpperCase()},
    });
    _channel?.sink.add(payload);
  }

  void _handleDisconnect() {
    _updateStatus(WebSocketStatus.disconnected);
    _channel?.sink.close();
    _channel = null;
  }

  void _updateStatus(WebSocketStatus newStatus) {
    _currentStatus = newStatus;
    _statusController.add(newStatus);
  }

  void dispose() {
    _handleDisconnect();
    _messagesController.close();
    _statusController.close();
  }
}
