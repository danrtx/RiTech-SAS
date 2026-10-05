import 'dart:collection';
import 'dart:math' as math;
import 'models.dart';
import 'tick_cache.dart';

class Aggregation {
  Aggregation(this.candles, this.discarded);
  final List<Candle> candles;
  final Map<String, int> discarded;
}

class CandleAggregator {
  Aggregation aggregate(
    Iterable<Tick> ticks, {
    required String symbol,
    required DateTime from,
    required DateTime until,
    required DateTime now,
  }) {
    final counts = <String, int>{};
    final seen = <Object>{};
    final prices = <DateTime, List<double>>{};
    DateTime? last;
    void discard(String reason) =>
        counts.update(reason, (n) => n + 1, ifAbsent: () => 1);
    for (final tick in ticks) {
      final time = tick.timestamp?.toUtc();
      final price = tick.price;
      if (tick.symbol != symbol) {
        discard('wrongSymbol');
        continue;
      }
      if (time == null || time.isAfter(now.toUtc())) {
        discard('invalidTimestamp');
        continue;
      }
      if (price == null || !price.isFinite || price <= 0) {
        discard('invalidPrice');
        continue;
      }
      if (time.isBefore(from)) {
        discard('late');
        continue;
      }
      if (!time.isBefore(until)) {
        continue;
      }
      if (!seen.add(InMemoryTickCache.identity(tick))) {
        discard('duplicate');
        continue;
      }
      if (last != null && time.isBefore(last)) {
        discard('outOfOrder');
        continue;
      }
      last = time;
      (prices[minuteUtc(time)] ??= []).add(price);
    }
    return Aggregation(
      prices.entries
          .map(
            (e) => Candle(
              minute: e.key,
              open: e.value.first,
              high: e.value.reduce(math.max),
              low: e.value.reduce(math.min),
              close: e.value.last,
            ),
          )
          .toList(),
      counts,
    );
  }
}

class AtrCalculator {
  AtrCalculator(this.period) {
    if (period < 1) {
      throw ArgumentError.value(period);
    }
  }
  final int period;
  double? _close, _atr;
  double _seed = 0;
  int _count = 0;
  AtrCalculator copy() => AtrCalculator(period)
    .._close = _close
    .._atr = _atr
    .._seed = _seed
    .._count = _count;
  double? add(Candle candle) {
    final previous = _close;
    final tr = previous == null
        ? candle.high - candle.low
        : math.max(
            candle.high - candle.low,
            math.max(
              (candle.high - previous).abs(),
              (candle.low - previous).abs(),
            ),
          );
    final count = _count + 1;
    final seed = _atr == null ? _seed + tr / period : _seed;
    final value = _atr == null
        ? (count >= period ? seed : null)
        : _atr! * ((period - 1) / period) + tr / period;
    if (!tr.isFinite || !seed.isFinite || (value != null && !value.isFinite)) {
      throw StateError('Non-finite ATR arithmetic');
    }
    _close = candle.close;
    _count = count;
    if (_atr == null) {
      _seed = seed;
    }
    _atr = value;
    return value;
  }

  void reset() {
    _close = null;
    _atr = null;
    _seed = 0;
    _count = 0;
  }
}

class Detection {
  const Detection(this.baseline, this.alert);
  final double? baseline;
  final bool alert;
}

class VolatilityDetector {
  VolatilityDetector(this.config);
  final AtrConfig config;
  final Queue<double> _history = Queue();
  DateTime? _lastAlert;
  VolatilityDetector copy() => VolatilityDetector(config)
    .._history.addAll(_history)
    .._lastAlert = _lastAlert;
  bool exceeds(double actual, double baseline) {
    if (!actual.isFinite || !baseline.isFinite || actual < 0 || baseline < 0) {
      throw ArgumentError('Invalid ATR or baseline');
    }
    if (baseline == 0) {
      return actual > 0;
    }
    final target = config.threshold * baseline;
    if (!target.isFinite) {
      throw StateError('Non-finite threshold');
    }
    return actual >= target ||
        target - actual <=
            config.epsilon * math.max(actual.abs(), target.abs());
  }

  Detection add(double value, DateTime minute) {
    if (!value.isFinite || value < 0) {
      throw ArgumentError.value(value);
    }
    final base = _history.length == config.baselineWindow
        ? _history.fold<double>(0, (sum, v) => sum + v / config.baselineWindow)
        : null;
    final alert =
        base != null &&
        exceeds(value, base) &&
        (_lastAlert == null ||
            minute.difference(_lastAlert!).inMinutes >= config.cooldownMinutes);
    if (alert) {
      _lastAlert = minute;
    }
    _history.add(value);
    if (_history.length > config.baselineWindow) {
      _history.removeFirst();
    }
    return Detection(base, alert);
  }

  void reset() {
    _history.clear();
    _lastAlert = null;
  }
}
