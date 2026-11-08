import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/websocket_client.dart';
import '../../../telemetry/presentation/providers/telemetry_provider.dart';
import '../../data/chart_repository.dart';
import '../../domain/chart_data.dart';

class ChartState {
  const ChartState({this.snapshot, this.loading = true, this.error});
  final ChartSnapshot? snapshot;
  final bool loading;
  final String? error;
}

final chartRepositoryProvider = Provider<ChartRepository>((ref) {
  final repository = ChartRepository();
  ref.onDispose(repository.dispose);
  return repository;
});

class ChartNotifier extends StateNotifier<ChartState> {
  ChartNotifier(this.repository, TelemetryWebSocketClient client,
      {bool polling = true})
      : super(const ChartState()) {
    _subscriptions.add(client.candlesStream.listen(_onCandle));
    _subscriptions.add(client.statusStream.listen((status) {
      if (status == WebSocketStatus.connected) unawaited(refresh());
    }));
    if (polling) {
      _timer = Timer.periodic(
          const Duration(seconds: 15), (_) => unawaited(refresh()));
    }
    unawaited(refresh());
  }
  final ChartRepository repository;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  final Map<int, ChartCandle> _updates = {};
  Timer? _timer;
  String? _selectedDate;
  int _request = 0;
  bool _loading = false;

  Future<void> selectDate(String? date) async {
    _selectedDate = date;
    _updates.clear();
    // Clear the previous session immediately: do not label old prices with the new date.
    state = const ChartState();
    await refresh(force: true);
  }

  Future<void> refresh({bool force = false}) async {
    if (!mounted || (_loading && !force)) return;
    _loading = true;
    final request = ++_request;
    try {
      final snapshot = await repository.load(date: _selectedDate);
      if (!mounted || request != _request) return;
      final merged =
          mergeCandles(snapshot.candles, _updates.values, snapshot.date);
      state =
          ChartState(snapshot: snapshot.withCandles(merged), loading: false);
      _updates.removeWhere((_, candle) =>
          candle.date != snapshot.date ||
          snapshot.candles.any((c) =>
              c.startTimeMs == candle.startTimeMs &&
              c.updatedAtMs >= candle.updatedAtMs));
    } catch (_) {
      if (!mounted || request != _request) return;
      state = ChartState(
          snapshot: state.snapshot,
          loading: false,
          error:
              'No se pudo actualizar la gráfica. Verifica la conexión con el backend.');
    } finally {
      if (request == _request) _loading = false;
    }
  }

  void _onCandle(Map<String, Object?> event) {
    if (!mounted || event['symbol'] != 'QQQ') return;
    try {
      final candle = ChartCandle.fromJson(Map<String, dynamic>.from(event));
      if (_selectedDate != null && candle.date != _selectedDate) return;
      final previous = _updates[candle.startTimeMs];
      if (previous == null || candle.updatedAtMs >= previous.updatedAtMs) {
        _updates[candle.startTimeMs] = candle;
      }
      final snapshot = state.snapshot;
      if (snapshot != null && candle.date == snapshot.date) {
        state = ChartState(
            snapshot: snapshot.withCandles(
                mergeCandles(snapshot.candles, [candle], snapshot.date)),
            loading: state.loading,
            error: state.error);
      } else if (_selectedDate == null) {
        unawaited(refresh());
      }
    } on FormatException {
      // Polling restores authoritative data if an event cannot be decoded.
    } on TypeError {
      // Do not let a malformed websocket event tear down the dashboard.
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    super.dispose();
  }
}

final chartProvider =
    StateNotifierProvider.autoDispose<ChartNotifier, ChartState>((ref) {
  return ChartNotifier(
      ref.watch(chartRepositoryProvider), ref.watch(telemetryWsClientProvider));
});
