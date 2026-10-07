import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';

enum WebSocketStatus { disconnected, connecting, connected }

abstract interface class TelemetryTransport {
  void on(String event, void Function(Object?) callback);
  void connect();
  void emit(String event, Map<String, Object?> data);
  void dispose();
}

class SocketIoTransport implements TelemetryTransport {
  SocketIoTransport(String url)
      : _socket = io.io(
            url,
            io.OptionBuilder()
                .setTransports(['websocket'])
                .disableAutoConnect()
                .enableForceNew()
                .enableReconnection()
                .setReconnectionDelay(100)
                .setReconnectionDelayMax(1000)
                .build());
  final io.Socket _socket;
  @override
  void on(String event, void Function(Object?) callback) =>
      _socket.on(event, callback);
  @override
  void connect() => _socket.connect();
  @override
  void emit(String event, Map<String, Object?> data) =>
      _socket.emit(event, data);
  @override
  void dispose() => _socket.dispose();
}

class TelemetryWebSocketClient {
  TelemetryWebSocketClient({TelemetryTransport? transport})
      : _transport = transport ?? SocketIoTransport(AppConfig.wsBaseUrl) {
    _transport.on('connect', (_) {
      if (_disposed) return;
      _updateStatus(WebSocketStatus.connected);
      if (_symbol != null) {
        _transport.emit('subscribe_symbol', {'symbol': _symbol});
      }
    });
    _transport.on(
        'disconnect', (_) => _updateStatus(WebSocketStatus.disconnected));
    _transport.on(
        'connect_error', (_) => _updateStatus(WebSocketStatus.disconnected));
    _transport.on(
        'telemetry_tick', (data) => _deliver(data, _messagesController));
    _transport.on('atr_result', (data) => _deliver(data, _atrController));
    _transport.on('chart_candle', (data) => _deliver(data, _candlesController));
  }
  final TelemetryTransport _transport;
  final _messagesController =
      StreamController<Map<String, Object?>>.broadcast();
  final _atrController = StreamController<Map<String, Object?>>.broadcast();
  final _candlesController = StreamController<Map<String, Object?>>.broadcast();
  final _statusController = StreamController<WebSocketStatus>.broadcast();
  bool _disposed = false;
  String? _symbol;
  WebSocketStatus _currentStatus = WebSocketStatus.disconnected;
  Stream<Map<String, Object?>> get messagesStream => _messagesController.stream;
  Stream<Map<String, Object?>> get atrStream => _atrController.stream;
  Stream<Map<String, Object?>> get candlesStream => _candlesController.stream;
  Stream<WebSocketStatus> get statusStream => _statusController.stream;
  WebSocketStatus get status => _currentStatus;

  void _deliver(
      Object? data, StreamController<Map<String, Object?>> controller) {
    if (_disposed || data is! Map || data.keys.any((key) => key is! String)) {
      return;
    }
    final message = Map<String, Object?>.from(data);
    if (message['symbol'] != _symbol) return;
    controller.add(message);
  }

  void connect() {
    if (_disposed || _currentStatus != WebSocketStatus.disconnected) return;
    _updateStatus(WebSocketStatus.connecting);
    _transport.connect();
  }

  void subscribeSymbol(String symbol) {
    if (_disposed) return;
    final next = symbol.toUpperCase();
    if (!RegExp(r'^[A-Z0-9._-]{1,32}$').hasMatch(next)) return;
    if (_symbol == next) return;
    if (_currentStatus == WebSocketStatus.connected && _symbol != null) {
      _transport.emit('unsubscribe_symbol', {'symbol': _symbol});
    }
    _symbol = next;
    if (_currentStatus == WebSocketStatus.connected) {
      _transport.emit('subscribe_symbol', {'symbol': next});
    }
  }

  void _updateStatus(WebSocketStatus status) {
    if (_disposed || _currentStatus == status) return;
    _currentStatus = status;
    _statusController.add(status);
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _currentStatus = WebSocketStatus.disconnected;
    _transport.dispose();
    unawaited(_messagesController.close());
    unawaited(_atrController.close());
    unawaited(_candlesController.close());
    unawaited(_statusController.close());
  }
}
