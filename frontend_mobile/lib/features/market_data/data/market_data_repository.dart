import '../../../core/network/api_client.dart';
import '../domain/market_data_models.dart';

class MarketDataRepository {
  MarketDataRepository({required ApiClient apiClient}) : _api = apiClient;
  final ApiClient _api;

  Future<HealthStatus> getHealth() => _api.get(
        '/health',
        fromJson: (json) =>
            HealthStatus.fromJson(json as Map<String, dynamic>),
      );

  Future<MarketDataStatus> getStatus() => _api.get(
        '/market-data/status',
        fromJson: (json) =>
            MarketDataStatus.fromJson(json as Map<String, dynamic>),
      );

  Future<List<Map<String, dynamic>>> getHistory({int limit = 500}) => _api.get(
        '/market-data/history',
        queryParameters: {'limit': limit},
        fromJson: (json) => (json as List<dynamic>)
            .map((e) => e as Map<String, dynamic>)
            .toList(),
      );

  Future<AtrSnapshot> getAtrSnapshot() => _api.get(
        '/atr',
        fromJson: (json) =>
            AtrSnapshot.fromJson(json as Map<String, dynamic>),
      );

  Future<List<PriceAlertRule>> getRules() => _api.get(
        '/market-data/rules',
        fromJson: (json) => (json as List<dynamic>)
            .map((e) => PriceAlertRule.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<PriceAlertRule> upsertRule(String id, PriceAlertRule rule) =>
      _api.put(
        '/market-data/rules/$id',
        data: rule.toJson(),
        fromJson: (json) =>
            PriceAlertRule.fromJson(json as Map<String, dynamic>),
      );

  Future<void> deleteRule(String id) => _api.delete('/market-data/rules/$id');

  Future<NdxInvestmentResult> evaluateInvestment({
    required String entryDate,
    required String valuationDate,
    required double investedAmount,
    required double upPercent,
    required double downPercent,
  }) =>
      _api.post(
        '/market-data/index/evaluate',
        data: {
          'entryDate': entryDate,
          'valuationDate': valuationDate,
          'investedAmount': investedAmount,
          'upPercent': upPercent,
          'downPercent': downPercent,
        },
        fromJson: (json) =>
            NdxInvestmentResult.fromJson(json as Map<String, dynamic>),
      );
}
