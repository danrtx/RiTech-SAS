import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/websocket_client.dart';

class TelemetryState {
  final WebSocketStatus connectionStatus;
  final Map<String, dynamic>? lastTick;
  final String activeSymbol;

  const TelemetryState({
    required this.connectionStatus,
    this.lastTick,
    this.activeSymbol = 'NDX',
  });

  TelemetryState copyWith({
    WebSocketStatus? connectionStatus,
    Map<String, dynamic>? lastTick,
    String? activeSymbol,
  }) {
    return TelemetryState(
      connectionStatus: connectionStatus ?? this.connectionStatus,
      lastTick: lastTick ?? this.lastTick,
      activeSymbol: activeSymbol ?? this.activeSymbol,
    );
  }
}

final telemetryWsClientProvider = Provider<TelemetryWebSocketClient>((ref) {
  final client = TelemetryWebSocketClient();
  ref.onDispose(() => client.dispose());
  return client;
});

class TelemetryNotifier extends StateNotifier<TelemetryState> {
  final TelemetryWebSocketClient _wsClient;

  TelemetryNotifier(this._wsClient)
      : super(const TelemetryState(connectionStatus: WebSocketStatus.disconnected)) {
    _initListeners();
  }

  void _initListeners() {
    _wsClient.statusStream.listen((status) {
      state = state.copyWith(connectionStatus: status);
    });

    _wsClient.messagesStream.listen((message) {
      state = state.copyWith(lastTick: message);
    });

    // Auto-connect on provider initialization
    _wsClient.connect();
    _wsClient.subscribeSymbol(state.activeSymbol);
  }

  void switchSymbol(String symbol) {
    state = state.copyWith(activeSymbol: symbol);
    _wsClient.subscribeSymbol(symbol);
  }

  void reconnect() {
    _wsClient.connect();
  }
}

final telemetryProvider =
    StateNotifierProvider<TelemetryNotifier, TelemetryState>((ref) {
  final wsClient = ref.watch(telemetryWsClientProvider);
  return TelemetryNotifier(wsClient);
});
