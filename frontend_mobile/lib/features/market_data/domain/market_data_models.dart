import 'package:equatable/equatable.dart';

class ServiceStatus extends Equatable {
  const ServiceStatus({required this.status, this.latencyMs, this.error});

  factory ServiceStatus.fromJson(Map<String, dynamic> json) => ServiceStatus(
        status: json['status'] as String,
        latencyMs: json['latencyMs'] as int?,
        error: json['error'] as String?,
      );

  final String status;
  final int? latencyMs;
  final String? error;

  bool get isUp => status == 'up';

  @override
  List<Object?> get props => [status, latencyMs, error];
}

class HealthStatus extends Equatable {
  const HealthStatus({
    required this.status,
    required this.timestamp,
    required this.postgres,
    required this.redis,
  });

  factory HealthStatus.fromJson(Map<String, dynamic> json) {
    final services = json['services'] as Map<String, dynamic>;
    return HealthStatus(
      status: json['status'] as String,
      timestamp: json['timestamp'] as String,
      postgres:
          ServiceStatus.fromJson(services['postgres'] as Map<String, dynamic>),
      redis: ServiceStatus.fromJson(services['redis'] as Map<String, dynamic>),
    );
  }

  final String status;
  final String timestamp;
  final ServiceStatus postgres;
  final ServiceStatus redis;

  bool get isOk => status == 'ok';

  @override
  List<Object?> get props => [status, timestamp, postgres, redis];
}

class MarketReadiness extends Equatable {
  const MarketReadiness({
    required this.transportReady,
    required this.freshDataReady,
    required this.requiredIndexAvailable,
    required this.exactContinuityReady,
    required this.blockingReasons,
  });

  factory MarketReadiness.fromJson(Map<String, dynamic> json) =>
      MarketReadiness(
        transportReady: json['transportReady'] as bool,
        freshDataReady: json['freshDataReady'] as bool,
        requiredIndexAvailable: json['requiredIndexAvailable'] as bool,
        exactContinuityReady: json['exactContinuityReady'] as bool,
        blockingReasons: (json['blockingReasons'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
      );

  final bool transportReady;
  final bool freshDataReady;
  final bool requiredIndexAvailable;
  final bool exactContinuityReady;
  final List<String> blockingReasons;

  bool get isFullyReady => blockingReasons.isEmpty;

  @override
  List<Object?> get props => [
        transportReady,
        freshDataReady,
        requiredIndexAvailable,
        exactContinuityReady,
        blockingReasons,
      ];
}

class MarketDataStatus extends Equatable {
  const MarketDataStatus({
    required this.connection,
    required this.ingestion,
    required this.recovery,
    required this.analysis,
    required this.readiness,
  });

  factory MarketDataStatus.fromJson(Map<String, dynamic> json) =>
      MarketDataStatus(
        connection: json['connection'] as Map<String, dynamic>,
        ingestion: json['ingestion'] as Map<String, dynamic>,
        recovery: json['recovery'] as Map<String, dynamic>,
        analysis: json['analysis'] as Map<String, dynamic>,
        readiness: MarketReadiness.fromJson(
            json['readiness'] as Map<String, dynamic>),
      );

  final Map<String, dynamic> connection;
  final Map<String, dynamic> ingestion;
  final Map<String, dynamic> recovery;
  final Map<String, dynamic> analysis;
  final MarketReadiness readiness;

  String get connectionState =>
      connection['state'] as String? ?? 'UNKNOWN';

  @override
  List<Object?> get props =>
      [connection, ingestion, recovery, analysis, readiness];
}

class AtrResult extends Equatable {
  const AtrResult({
    required this.symbol,
    required this.minute,
    required this.status,
    this.atr,
    this.baseline,
    required this.alert,
  });

  factory AtrResult.fromJson(Map<String, dynamic> json) => AtrResult(
        symbol: json['symbol'] as String,
        minute: json['minute'] as int,
        status: json['status'] as String,
        atr: (json['atr'] as num?)?.toDouble(),
        baseline: (json['baseline'] as num?)?.toDouble(),
        alert: json['alert'] as bool,
      );

  final String symbol;
  final int minute;
  final String status;
  final double? atr;
  final double? baseline;
  final bool alert;

  bool get isReady => status == 'ready';

  @override
  List<Object?> get props => [symbol, minute, status, atr, baseline, alert];
}

class AtrSnapshot extends Equatable {
  const AtrSnapshot({required this.results, required this.metrics});

  factory AtrSnapshot.fromJson(Map<String, dynamic> json) => AtrSnapshot(
        results: (json['results'] as List<dynamic>)
            .map((e) => AtrResult.fromJson(e as Map<String, dynamic>))
            .toList(),
        metrics: json['metrics'] as Map<String, dynamic>,
      );

  final List<AtrResult> results;
  final Map<String, dynamic> metrics;

  @override
  List<Object?> get props => [results, metrics];
}

class PriceAlertRule extends Equatable {
  const PriceAlertRule({
    required this.id,
    required this.upPercent,
    required this.downPercent,
    required this.thresholdBasis,
    required this.enabled,
    this.referenceMode,
    this.entryPrice,
    this.windowMs,
    this.investedAmount,
    this.cooldownMs = 60000,
  });

  factory PriceAlertRule.fromJson(Map<String, dynamic> json) => PriceAlertRule(
        id: json['id'] as String,
        upPercent: (json['upPercent'] as num).toDouble(),
        downPercent: (json['downPercent'] as num).toDouble(),
        thresholdBasis: json['thresholdBasis'] as String,
        enabled: json['enabled'] as bool,
        referenceMode: json['referenceMode'] as String?,
        entryPrice: (json['entryPrice'] as num?)?.toDouble(),
        windowMs: json['windowMs'] as int?,
        investedAmount: (json['investedAmount'] as num?)?.toDouble(),
        cooldownMs: json['cooldownMs'] as int? ?? 60000,
      );

  final String id;
  final double upPercent;
  final double downPercent;
  final String thresholdBasis;
  final bool enabled;
  final String? referenceMode;
  final double? entryPrice;
  final int? windowMs;
  final double? investedAmount;
  final int cooldownMs;

  Map<String, dynamic> toJson() => {
        'upPercent': upPercent,
        'downPercent': downPercent,
        'thresholdBasis': thresholdBasis,
        'enabled': enabled,
        if (referenceMode != null) 'referenceMode': referenceMode,
        if (entryPrice != null) 'entryPrice': entryPrice,
        if (windowMs != null) 'windowMs': windowMs,
        if (investedAmount != null) 'investedAmount': investedAmount,
        'cooldownMs': cooldownMs,
      };

  @override
  List<Object?> get props => [
        id,
        upPercent,
        downPercent,
        thresholdBasis,
        enabled,
        referenceMode,
        entryPrice,
        windowMs,
        investedAmount,
        cooldownMs,
      ];
}

class NdxInvestmentResult extends Equatable {
  const NdxInvestmentResult({required this.data});

  factory NdxInvestmentResult.fromJson(Map<String, dynamic> json) =>
      NdxInvestmentResult(data: json);

  final Map<String, dynamic> data;

  @override
  List<Object?> get props => [data];
}
