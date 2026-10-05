import 'dart:collection';
import 'models.dart';

class TickSnapshot {
  TickSnapshot(Iterable<Tick> ticks, {this.coverageStart})
    : ticks = List.unmodifiable(ticks);
  final List<Tick> ticks;

  /// Earliest complete minute retained; null means no known eviction.
  final DateTime? coverageStart;
}

abstract interface class TickCache {
  /// Stable snapshot in reception order. Include malformed entries for validation.
  Future<TickSnapshot> read(
    String symbol, {
    required DateTime from,
    required DateTime until,
  });
}

class InMemoryTickCache implements TickCache {
  InMemoryTickCache({required this.now, required this.config, this.onLog});
  final Now now;
  final AtrConfig config;
  final LogSink? onLog;
  final Queue<Tick> _ticks = Queue();
  final Map<String, DateTime> _last = {};
  final Map<String, DateTime> _coverage = {};
  final Map<String, DateTime> _closedUntil = {};
  final Map<String, Set<Object>> _seen = {};

  static Object identity(Tick tick) =>
      tick.id ?? (tick.timestamp?.toUtc().microsecondsSinceEpoch, tick.price);

  bool add(Tick tick) {
    final stamp = tick.timestamp?.toUtc();
    final price = tick.price;
    String? reason;
    if (!config.symbols.contains(tick.symbol)) {
      reason = 'unknownSymbol';
    } else if (stamp == null || stamp.isAfter(now().toUtc())) {
      reason = 'invalidTimestamp';
    } else if (price == null || !price.isFinite || price <= 0) {
      reason = 'invalidPrice';
    } else if ((_seen[tick.symbol] ?? {}).contains(identity(tick))) {
      reason = 'duplicate';
    } else if (_closedUntil[tick.symbol] != null &&
        stamp.isBefore(_closedUntil[tick.symbol]!)) {
      reason = 'late';
    } else if (_last[tick.symbol] != null &&
        stamp.isBefore(_last[tick.symbol]!)) {
      reason = 'outOfOrder';
    } else if (stamp.isBefore(
      now().toUtc().subtract(Duration(minutes: config.retentionMinutes)),
    )) {
      reason = 'expired';
    }
    if (reason != null) {
      _log(EngineLog(reason, symbol: tick.symbol));
      return false;
    }
    _last[tick.symbol] = stamp!;
    (_seen[tick.symbol] ??= {}).add(identity(tick));
    _ticks.add(tick);
    while (_ticks.length > config.maxTicks) {
      _evict(_ticks.removeFirst());
    }
    return true;
  }

  void _prune() {
    final cutoff = now().toUtc().subtract(
      Duration(minutes: config.retentionMinutes),
    );
    final length = _ticks.length;
    for (var index = 0; index < length; index++) {
      final tick = _ticks.removeFirst();
      if (tick.timestamp!.isBefore(cutoff)) {
        _evict(tick);
      } else {
        _ticks.addLast(tick);
      }
    }
    while (_ticks.length > config.maxTicks) {
      _evict(_ticks.removeFirst());
    }
  }

  void _evict(Tick tick) {
    _seen[tick.symbol]?.remove(identity(tick));
    final start = minuteUtc(tick.timestamp!).add(const Duration(minutes: 1));
    if (_coverage[tick.symbol] == null ||
        start.isAfter(_coverage[tick.symbol]!)) {
      _coverage[tick.symbol] = start;
    }
    _log(EngineLog('cacheEviction', symbol: tick.symbol));
  }

  void _log(EngineLog event) {
    try {
      onLog?.call(event);
    } on Object {
      /* Logging must not break ingestion. */
    }
  }

  @override
  Future<TickSnapshot> read(
    String symbol, {
    required DateTime from,
    required DateTime until,
  }) async {
    _prune();
    final boundary = minuteUtc(until);
    if (boundary.isAfter(minuteUtc(now()))) {
      throw ArgumentError('Cannot close a future minute');
    }
    if (_closedUntil[symbol] == null ||
        boundary.isAfter(_closedUntil[symbol]!)) {
      _closedUntil[symbol] = boundary;
    }
    return TickSnapshot(
      _ticks.where(
        (t) =>
            t.symbol == symbol &&
            !t.timestamp!.isBefore(from) &&
            t.timestamp!.isBefore(until),
      ),
      coverageStart: _coverage[symbol],
    );
  }
}
