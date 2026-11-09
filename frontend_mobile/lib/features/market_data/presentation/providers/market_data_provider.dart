import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/api_client.dart';
import '../../data/market_data_repository.dart';
import '../../domain/market_data_models.dart';

final apiClientProvider = Provider<ApiClient>((_) => ApiClient());

final marketDataRepositoryProvider = Provider<MarketDataRepository>(
  (ref) => MarketDataRepository(apiClient: ref.watch(apiClientProvider)),
);

class MarketDataState {
  const MarketDataState({
    this.health,
    this.status,
    this.atr,
    this.rules,
    this.loading = false,
    this.error,
    this.lastRefresh,
  });

  final HealthStatus? health;
  final MarketDataStatus? status;
  final AtrSnapshot? atr;
  final List<PriceAlertRule>? rules;
  final bool loading;
  final String? error;
  final DateTime? lastRefresh;

  bool get hasData => health != null || status != null;

  MarketDataState copyWith({
    HealthStatus? health,
    MarketDataStatus? status,
    AtrSnapshot? atr,
    List<PriceAlertRule>? rules,
    bool? loading,
    String? error,
    DateTime? lastRefresh,
  }) =>
      MarketDataState(
        health: health ?? this.health,
        status: status ?? this.status,
        atr: atr ?? this.atr,
        rules: rules ?? this.rules,
        loading: loading ?? this.loading,
        error: error,
        lastRefresh: lastRefresh ?? this.lastRefresh,
      );
}

class MarketDataNotifier extends StateNotifier<MarketDataState> {
  MarketDataNotifier(this._repo) : super(const MarketDataState());
  final MarketDataRepository _repo;

  static const _staleThreshold = Duration(seconds: 30);

  bool get _isStale {
    if (state.lastRefresh == null) return true;
    return DateTime.now().difference(state.lastRefresh!) > _staleThreshold;
  }

  Future<void> refresh({bool force = false}) async {
    if (state.loading) return;
    if (!force && !_isStale) return;

    state = state.copyWith(loading: true);
    try {
      final results = await Future.wait([
        _repo.getHealth(),
        _repo.getStatus(),
        _repo.getAtrSnapshot(),
        _repo.getRules(),
      ]);
      state = MarketDataState(
        health: results[0] as HealthStatus,
        status: results[1] as MarketDataStatus,
        atr: results[2] as AtrSnapshot,
        rules: results[3] as List<PriceAlertRule>,
        lastRefresh: DateTime.now(),
      );
    } on ApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    } on Exception catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }

  Future<void> refreshHealth() async {
    try {
      final health = await _repo.getHealth();
      state = state.copyWith(health: health);
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  Future<void> refreshStatus() async {
    try {
      final status = await _repo.getStatus();
      state = state.copyWith(status: status);
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }
}

final marketDataProvider =
    StateNotifierProvider<MarketDataNotifier, MarketDataState>(
  (ref) => MarketDataNotifier(ref.watch(marketDataRepositoryProvider)),
);
