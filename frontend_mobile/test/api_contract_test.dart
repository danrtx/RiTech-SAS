import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/core/network/api_client.dart';
import 'package:ritech_mobile/features/market_data/domain/market_data_models.dart';
import 'package:ritech_mobile/features/market_data/data/market_data_repository.dart';
import 'package:ritech_mobile/features/market_data/presentation/providers/market_data_provider.dart';

void main() {
  group('HealthStatus', () {
    test('fromJson parsea respuesta correcta', () {
      final json = {
        'status': 'ok',
        'timestamp': '2026-11-07T10:00:00.000Z',
        'services': {
          'postgres': {'status': 'up', 'latencyMs': 5},
          'redis': {'status': 'up', 'latencyMs': 2},
        },
      };
      final health = HealthStatus.fromJson(json);
      expect(health.isOk, true);
      expect(health.postgres.isUp, true);
      expect(health.postgres.latencyMs, 5);
      expect(health.redis.isUp, true);
      expect(health.redis.latencyMs, 2);
    });

    test('fromJson parsea servicio caído', () {
      final json = {
        'status': 'error',
        'timestamp': '2026-11-07T10:00:00.000Z',
        'services': {
          'postgres': {'status': 'down', 'error': 'Connection refused'},
          'redis': {'status': 'up', 'latencyMs': 1},
        },
      };
      final health = HealthStatus.fromJson(json);
      expect(health.isOk, false);
      expect(health.postgres.isUp, false);
      expect(health.postgres.error, 'Connection refused');
    });

    test('equatable compara correctamente', () {
      final a = HealthStatus.fromJson({
        'status': 'ok',
        'timestamp': '2026-11-07T10:00:00.000Z',
        'services': {
          'postgres': {'status': 'up', 'latencyMs': 5},
          'redis': {'status': 'up', 'latencyMs': 2},
        },
      });
      final b = HealthStatus.fromJson({
        'status': 'ok',
        'timestamp': '2026-11-07T10:00:00.000Z',
        'services': {
          'postgres': {'status': 'up', 'latencyMs': 5},
          'redis': {'status': 'up', 'latencyMs': 2},
        },
      });
      expect(a, equals(b));
    });
  });

  group('MarketReadiness', () {
    test('fromJson sin blocking reasons → isFullyReady', () {
      final json = {
        'transportReady': true,
        'freshDataReady': true,
        'requiredIndexAvailable': true,
        'exactContinuityReady': true,
        'blockingReasons': <String>[],
      };
      final readiness = MarketReadiness.fromJson(json);
      expect(readiness.isFullyReady, true);
      expect(readiness.transportReady, true);
    });

    test('fromJson con blocking reasons → no isFullyReady', () {
      final json = {
        'transportReady': false,
        'freshDataReady': false,
        'requiredIndexAvailable': true,
        'exactContinuityReady': false,
        'blockingReasons': ['TRANSPORT_UNAVAILABLE', 'NO_FRESH_PRICES'],
      };
      final readiness = MarketReadiness.fromJson(json);
      expect(readiness.isFullyReady, false);
      expect(readiness.blockingReasons.length, 2);
    });
  });

  group('MarketDataStatus', () {
    test('fromJson parsea estructura completa', () {
      final json = {
        'connection': {'state': 'LIVE', 'reconnects': 0},
        'ingestion': {'live': true, 'ticksProcessed': 1500},
        'recovery': {'continuity': {'continuityRestored': true}},
        'analysis': {'fresh': true, 'marketReference': {'matchesRequiredIndex': true}},
        'readiness': {
          'transportReady': true,
          'freshDataReady': true,
          'requiredIndexAvailable': true,
          'exactContinuityReady': true,
          'blockingReasons': <String>[],
        },
      };
      final status = MarketDataStatus.fromJson(json);
      expect(status.connectionState, 'LIVE');
      expect(status.readiness.isFullyReady, true);
    });

    test('connectionState devuelve UNKNOWN si no hay state', () {
      final json = {
        'connection': <String, dynamic>{},
        'ingestion': <String, dynamic>{},
        'recovery': <String, dynamic>{},
        'analysis': <String, dynamic>{},
        'readiness': {
          'transportReady': false,
          'freshDataReady': false,
          'requiredIndexAvailable': false,
          'exactContinuityReady': false,
          'blockingReasons': <String>[],
        },
      };
      final status = MarketDataStatus.fromJson(json);
      expect(status.connectionState, 'UNKNOWN');
    });
  });

  group('AtrResult', () {
    test('fromJson con datos completos', () {
      final json = {
        'symbol': 'QQQ',
        'minute': 1730973600000,
        'status': 'ready',
        'atr': 0.4523,
        'baseline': 0.3100,
        'alert': false,
      };
      final result = AtrResult.fromJson(json);
      expect(result.symbol, 'QQQ');
      expect(result.isReady, true);
      expect(result.atr, closeTo(0.4523, 0.0001));
      expect(result.alert, false);
    });

    test('fromJson con atr null (gap)', () {
      final json = {
        'symbol': 'QQQ',
        'minute': 1730973600000,
        'status': 'gap',
        'atr': null,
        'baseline': null,
        'alert': false,
      };
      final result = AtrResult.fromJson(json);
      expect(result.isReady, false);
      expect(result.atr, isNull);
    });
  });

  group('AtrSnapshot', () {
    test('fromJson parsea resultados y métricas', () {
      final json = {
        'results': [
          {
            'symbol': 'QQQ',
            'minute': 1730973600000,
            'status': 'ready',
            'atr': 0.45,
            'baseline': 0.31,
            'alert': false,
          },
        ],
        'metrics': {'cycles': 100, 'failures': 0},
      };
      final snapshot = AtrSnapshot.fromJson(json);
      expect(snapshot.results.length, 1);
      expect(snapshot.results.first.symbol, 'QQQ');
      expect(snapshot.metrics['cycles'], 100);
    });
  });

  group('PriceAlertRule', () {
    test('fromJson y toJson son inversos', () {
      final json = {
        'id': 'rule-1',
        'upPercent': 3.0,
        'downPercent': 2.0,
        'thresholdBasis': 'REFERENCE',
        'enabled': true,
        'referenceMode': 'WINDOW',
        'windowMs': 300000,
        'cooldownMs': 60000,
      };
      final rule = PriceAlertRule.fromJson(json);
      expect(rule.id, 'rule-1');
      expect(rule.upPercent, 3.0);
      expect(rule.thresholdBasis, 'REFERENCE');

      final exported = rule.toJson();
      expect(exported['upPercent'], 3.0);
      expect(exported['downPercent'], 2.0);
      expect(exported['thresholdBasis'], 'REFERENCE');
      expect(exported['referenceMode'], 'WINDOW');
      expect(exported.containsKey('id'), false);
    });

    test('fromJson con INVESTMENT basis e investedAmount', () {
      final json = {
        'id': 'rule-2',
        'upPercent': 2.0,
        'downPercent': 2.0,
        'thresholdBasis': 'INVESTMENT',
        'enabled': true,
        'investedAmount': 50000.0,
        'cooldownMs': 30000,
      };
      final rule = PriceAlertRule.fromJson(json);
      expect(rule.thresholdBasis, 'INVESTMENT');
      expect(rule.investedAmount, 50000.0);
      expect(rule.cooldownMs, 30000);
    });

    test('toJson omite campos opcionales nulos', () {
      final json = {
        'id': 'rule-3',
        'upPercent': 1.0,
        'downPercent': 1.0,
        'thresholdBasis': 'REFERENCE',
        'enabled': false,
        'cooldownMs': 60000,
      };
      final rule = PriceAlertRule.fromJson(json);
      final exported = rule.toJson();
      expect(exported.containsKey('referenceMode'), false);
      expect(exported.containsKey('entryPrice'), false);
      expect(exported.containsKey('investedAmount'), false);
    });
  });

  group('ApiException', () {
    test('tipos de error mapeados correctamente', () {
      const network = ApiException(ApiErrorType.network, 'Sin conexión');
      expect(network.type, ApiErrorType.network);
      expect(network.toString(), contains('network'));

      const session = ApiException(
          ApiErrorType.sessionInvalid, 'Sesión inválida',
          statusCode: 401);
      expect(session.statusCode, 401);
    });

    test('todos los tipos de error definidos', () {
      expect(ApiErrorType.values.length, 6);
      expect(ApiErrorType.values, contains(ApiErrorType.network));
      expect(ApiErrorType.values, contains(ApiErrorType.timeout));
      expect(ApiErrorType.values, contains(ApiErrorType.server));
      expect(ApiErrorType.values, contains(ApiErrorType.notFound));
      expect(ApiErrorType.values, contains(ApiErrorType.sessionInvalid));
      expect(ApiErrorType.values, contains(ApiErrorType.unknown));
    });
  });

  group('MarketDataState', () {
    test('estado inicial sin datos', () {
      const state = MarketDataState();
      expect(state.hasData, false);
      expect(state.loading, false);
      expect(state.error, isNull);
      expect(state.lastRefresh, isNull);
    });

    test('copyWith preserva campos no modificados', () {
      final health = HealthStatus.fromJson({
        'status': 'ok',
        'timestamp': '2026-11-07T10:00:00.000Z',
        'services': {
          'postgres': {'status': 'up', 'latencyMs': 5},
          'redis': {'status': 'up', 'latencyMs': 2},
        },
      });
      final state = MarketDataState(health: health);
      final updated = state.copyWith(loading: true);
      expect(updated.health, equals(health));
      expect(updated.loading, true);
    });

    test('copyWith con error limpia error previo', () {
      const state = MarketDataState(error: 'Error previo');
      final cleared = state.copyWith();
      expect(cleared.error, isNull);
    });
  });

  group('MarketDataRepository', () {
    test('se instancia con ApiClient', () {
      final repo = MarketDataRepository(apiClient: ApiClient());
      expect(repo, isNotNull);
    });
  });
}
