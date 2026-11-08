import 'dart:math' as math;

class ChartCandle {
  const ChartCandle(
      {required this.startTimeMs,
      required this.timeLabel,
      required this.date,
      required this.open,
      required this.high,
      required this.low,
      required this.close,
      required this.source,
      required this.updatedAtMs,
      this.volume});
  final int startTimeMs;
  final String timeLabel;
  final String date;
  final double open, high, low, close;
  final double? volume;
  final String source;
  final int updatedAtMs;

  factory ChartCandle.fromJson(Map<String, dynamic> json) {
    double number(String key) {
      final value = json[key];
      if (value is! num || !value.isFinite) {
        throw const FormatException('Invalid candle');
      }
      return value.toDouble();
    }

    final candle = ChartCandle(
        startTimeMs: number('startTimeMs').toInt(),
        timeLabel: json['timeLabel'] as String,
        date: json['date'] as String,
        open: number('open'),
        high: number('high'),
        low: number('low'),
        close: number('close'),
        source: json['source'] as String,
        updatedAtMs: number('updatedAtMs').toInt(),
        volume: json['volume'] == null ? null : number('volume'));
    if (candle.low <= 0 ||
        candle.high < math.max(candle.open, candle.close) ||
        candle.low > math.min(candle.open, candle.close) ||
        (candle.volume ?? 0) < 0) {
      throw const FormatException('Invalid OHLC');
    }
    return candle;
  }
}

/// Merge by database revision so an HTTP snapshot cannot overwrite a newer WS candle.
List<ChartCandle> mergeCandles(
    Iterable<ChartCandle> base, Iterable<ChartCandle> updates, String date) {
  final byMinute = {
    for (final candle in base.where((c) => c.date == date))
      candle.startTimeMs: candle
  };
  for (final candle in updates.where((c) => c.date == date)) {
    final old = byMinute[candle.startTimeMs];
    if (old == null ||
        candle.updatedAtMs > old.updatedAtMs ||
        (candle.updatedAtMs == old.updatedAtMs &&
            candle.source == 'provider_ohlc')) {
      byMinute[candle.startTimeMs] = candle;
    }
  }
  return List.unmodifiable(byMinute.values.toList()
    ..sort((a, b) => a.startTimeMs.compareTo(b.startTimeMs)));
}

List<ChartCandle> aggregateCandles(List<ChartCandle> candles, int minutes) {
  if (minutes == 1) return candles;
  final result = <ChartCandle>[];
  final duration = minutes * 60000;
  for (final candle in candles) {
    final bucket = candle.startTimeMs ~/ duration * duration;
    final previous = result.isEmpty ? null : result.last;
    if (previous == null ||
        previous.startTimeMs != bucket ||
        previous.date != candle.date) {
      final time = candle.timeLabel.split(':');
      final minute = int.parse(time[1]) ~/ minutes * minutes;
      result.add(ChartCandle(
          startTimeMs: bucket,
          date: candle.date,
          timeLabel: '${time[0]}:${minute.toString().padLeft(2, '0')}',
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          source: candle.source,
          updatedAtMs: candle.updatedAtMs));
    } else {
      result[result.length - 1] = ChartCandle(
          startTimeMs: bucket,
          date: candle.date,
          timeLabel: previous.timeLabel,
          open: previous.open,
          high: math.max(previous.high, candle.high),
          low: math.min(previous.low, candle.low),
          close: candle.close,
          // A missing minute volume must not be represented as a known zero.
          volume: previous.volume == null || candle.volume == null
              ? null
              : previous.volume! + candle.volume!,
          source: previous.source == 'stream' || candle.source == 'stream'
              ? 'stream'
              : 'provider_ohlc',
          updatedAtMs: math.max(previous.updatedAtMs, candle.updatedAtMs));
    }
  }
  return result;
}

class ChartSnapshot {
  const ChartSnapshot(
      {required this.date,
      required this.today,
      required this.dates,
      required this.candles,
      required this.session,
      required this.historyState,
      required this.fresh,
      required this.providerConnected,
      this.lastEventMs});
  final String date, today, session, historyState;
  final List<String> dates;
  final List<ChartCandle> candles;
  final bool fresh, providerConnected;
  final int? lastEventMs;
  factory ChartSnapshot.fromJson(Map<String, dynamic> json) => ChartSnapshot(
      date: json['date'] as String,
      today: json['today'] as String,
      dates: List<String>.from(json['availableDates'] as List),
      candles: (json['candles'] as List)
          .map((c) => ChartCandle.fromJson(Map<String, dynamic>.from(c as Map)))
          .toList(),
      session: json['session'] as String,
      historyState: json['storage']['history']['state'] as String,
      fresh: json['stream']['fresh'] == true,
      providerConnected: json['stream']['connected'] == true,
      lastEventMs: (json['stream']['lastEventMs'] as num?)?.toInt());
  ChartSnapshot withCandles(List<ChartCandle> value) => ChartSnapshot(
      date: date,
      today: today,
      dates: dates,
      candles: value,
      session: session,
      historyState: historyState,
      fresh: fresh,
      providerConnected: providerConnected,
      lastEventMs: lastEventMs);
  double? get change =>
      candles.isEmpty ? null : candles.last.close - candles.first.open;
  double? get changePercent =>
      candles.isEmpty ? null : change! / candles.first.open * 100;
  double? get high =>
      candles.isEmpty ? null : candles.map((c) => c.high).reduce(math.max);
  double? get low =>
      candles.isEmpty ? null : candles.map((c) => c.low).reduce(math.min);
}
