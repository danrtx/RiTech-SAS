import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/core/network/api_client.dart';
import 'package:ritech_mobile/features/market_data/data/market_data_repository.dart';

class HistoryApi extends ApiClient {
  @override
  Future<T> get<T>(String path, {Map<String, dynamic>? queryParameters,
    required T Function(dynamic json) fromJson}) async {
    expect(path, '/market-data/history');
    expect(queryParameters, {'limit': 10});
    return fromJson({'symbol': 'QQQ', 'points': 1, 'samples': [{'price': 100.0}]});
  }
}

void main() {
  test('history reads samples from the backend envelope', () async {
    final repository = MarketDataRepository(apiClient: HistoryApi());
    expect(await repository.getHistory(limit: 10), [{'price': 100.0}]);
  });
}
