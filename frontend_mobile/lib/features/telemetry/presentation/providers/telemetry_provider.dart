import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/websocket_client.dart';
import '../../../../core/config/app_config.dart';

class TelemetryState {
  final WebSocketStatus connectionStatus;
  final Map<String, Object?>? lastTick;
  final Map<String, Object?>? lastAtr;
  final String activeSymbol;
  const TelemetryState(
      {required this.connectionStatus,
      this.lastTick,
      this.lastAtr,
      this.activeSymbol = AppConfig.marketSymbol});
  TelemetryState copyWith(
          {WebSocketStatus? connectionStatus,
          Map<String, Object?>? lastTick,
          Map<String, Object?>? lastAtr,
          String? activeSymbol,
          bool clearData = false}) =>
      TelemetryState(
          connectionStatus: connectionStatus ?? this.connectionStatus,
          lastTick: clearData ? null : lastTick ?? this.lastTick,
          lastAtr: clearData ? null : lastAtr ?? this.lastAtr,
          activeSymbol: activeSymbol ?? this.activeSymbol);
}

final telemetryWsClientProvider = Provider<TelemetryWebSocketClient>((ref) {
  final client = TelemetryWebSocketClient();
  ref.onDispose(client.dispose);
  return client;
});

class TelemetryNotifier extends StateNotifier<TelemetryState> {
  final TelemetryWebSocketClient _wsClient;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  TelemetryNotifier(this._wsClient)
      : super(const TelemetryState(
            connectionStatus: WebSocketStatus.disconnected)) {
    _subscriptions.add(_wsClient.statusStream.listen((status) {
      state = state.copyWith(
          connectionStatus: status,
          clearData: status != WebSocketStatus.connected);
    }));
    _subscriptions.add(_wsClient.messagesStream.listen((message) {
      if (message['symbol'] == state.activeSymbol) {
        state = state.copyWith(lastTick: message);
      }
    }));
    _subscriptions.add(_wsClient.atrStream.listen((message) {
      if (message['symbol'] == state.activeSymbol) {
        state = state.copyWith(lastAtr: message);
      }
    }));
    _wsClient.subscribeSymbol(state.activeSymbol);
    _wsClient.connect();
  }
  void switchSymbol(String symbol) {
    final next = symbol.toUpperCase();
    if (next == state.activeSymbol) return;
    state = state.copyWith(activeSymbol: next, clearData: true);
    _wsClient.subscribeSymbol(next);
  }

  void reconnect() => _wsClient.connect();
  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    super.dispose();
  }
}

final telemetryProvider =
    StateNotifierProvider<TelemetryNotifier, TelemetryState>((ref) {
  return TelemetryNotifier(ref.watch(telemetryWsClientProvider));
});
