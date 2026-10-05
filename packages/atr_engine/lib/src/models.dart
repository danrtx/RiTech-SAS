typedef Now = DateTime Function();
typedef LogSink = void Function(EngineLog event);

DateTime minuteUtc(DateTime time) {
  final utc = time.toUtc();
  return DateTime.utc(utc.year, utc.month, utc.day, utc.hour, utc.minute);
}

class AtrConfig {
  AtrConfig({
    required Iterable<String> symbols,
    this.period = 14,
    this.threshold = 1.5,
    this.baselineWindow = 20,
    this.maxGapMinutes = 5,
    this.cooldownMinutes = 0,
    this.epsilon = 1e-12,
    this.retentionMinutes = 1440,
    this.maxTicks = 100000,
    this.readTimeout = const Duration(seconds: 10),
  }) : symbols = Set.unmodifiable(symbols) {
    if (this.symbols.isEmpty ||
        this.symbols.any((s) => s.trim().isEmpty) ||
        period < 1 ||
        baselineWindow < 1 ||
        maxGapMinutes < 0 ||
        cooldownMinutes < 0 ||
        !threshold.isFinite ||
        threshold <= 0 ||
        !epsilon.isFinite ||
        epsilon < 0 ||
        epsilon >= 1 ||
        retentionMinutes < period + baselineWindow ||
        maxTicks < 1 ||
        readTimeout <= Duration.zero) {
      throw ArgumentError('Invalid ATR configuration');
    }
  }
  factory AtrConfig.fromJson(Map<String, Object?> json) => AtrConfig(
    symbols: (json['symbols'] as List<Object?>).cast<String>(),
    period: json['period'] as int? ?? 14,
    threshold: (json['threshold'] as num?)?.toDouble() ?? 1.5,
    baselineWindow: json['baselineWindow'] as int? ?? 20,
    maxGapMinutes: json['maxGapMinutes'] as int? ?? 5,
    cooldownMinutes: json['cooldownMinutes'] as int? ?? 0,
    epsilon: (json['epsilon'] as num?)?.toDouble() ?? 1e-12,
    retentionMinutes: json['retentionMinutes'] as int? ?? 1440,
    maxTicks: json['maxTicks'] as int? ?? 100000,
    readTimeout: Duration(milliseconds: json['readTimeoutMs'] as int? ?? 10000),
  );
  final Set<String> symbols;
  final int period, baselineWindow, maxGapMinutes, cooldownMinutes;
  final int retentionMinutes, maxTicks;
  final double threshold, epsilon;
  final Duration readTimeout;
}

class Tick {
  const Tick({
    required this.symbol,
    required this.price,
    required this.timestamp,
    this.id,
  });
  factory Tick.parse({
    required String symbol,
    required double? price,
    required String? timestamp,
    String? id,
  }) => Tick(
    symbol: symbol,
    price: price,
    timestamp: _parseTimestamp(timestamp),
    id: id,
  );
  final String symbol;
  final double? price;
  final DateTime? timestamp;
  final String? id;
}

// Require an explicit timezone and reject normalized invalid dates (e.g. Feb 30).
DateTime? _parseTimestamp(String? input) {
  if (input == null) {
    return null;
  }
  final match = RegExp(
    r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$',
  ).firstMatch(input);
  if (match == null) {
    return null;
  }
  final year = int.parse(match[1]!);
  final month = int.parse(match[2]!);
  final day = int.parse(match[3]!);
  final hour = int.parse(match[4]!);
  final minute = int.parse(match[5]!);
  final second = int.parse(match[6]!);
  final date = DateTime.utc(year, month, day);
  final zone = match[7]!;
  if (date.year != year ||
      date.month != month ||
      date.day != day ||
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      (zone != 'Z' &&
          (int.parse(zone.substring(1, 3)) > 23 ||
              int.parse(zone.substring(4, 6)) > 59))) {
    return null;
  }
  return DateTime.tryParse(input)?.toUtc();
}

class Candle {
  Candle({
    required this.minute,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
  }) {
    if (minute != minuteUtc(minute) ||
        !minute.isUtc ||
        [open, high, low, close].any((p) => !p.isFinite || p <= 0) ||
        low > high ||
        open < low ||
        open > high ||
        close < low ||
        close > high) {
      throw ArgumentError('Invalid candle');
    }
  }
  final DateTime minute;
  final double open, high, low, close;
}

enum DataStatus { insufficientData, baselineWarmingUp, ready, gap, cacheError }

class AtrResult {
  const AtrResult({
    required this.symbol,
    required this.minute,
    required this.emittedAt,
    required this.status,
    this.atr,
    this.baseline,
  });
  final String symbol;
  final DateTime minute, emittedAt;
  final DataStatus status;
  final double? atr, baseline;
}

class VolatilityAlert {
  const VolatilityAlert(this.result, this.threshold);
  final AtrResult result;
  final double threshold;
}

class EngineLog {
  const EngineLog(this.code, {this.symbol, this.count = 1, this.error});
  final String code;
  final String? symbol;
  final int count;
  final Object? error;
}

class EngineMetrics {
  int cycles = 0, skippedCycles = 0, alerts = 0, failures = 0, resets = 0;
  Duration lastDuration = Duration.zero;
  final Map<String, int> discarded = {};
  void discard(String reason, int count) =>
      discarded.update(reason, (value) => value + count, ifAbsent: () => count);
}
