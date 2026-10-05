import 'dart:async';
import 'calculators.dart';
import 'minute_scheduler.dart';
import 'models.dart';
import 'tick_cache.dart';

class _SymbolState {
  _SymbolState(AtrConfig config)
    : calculator = AtrCalculator(config.period),
      detector = VolatilityDetector(config);
  AtrCalculator calculator;
  VolatilityDetector detector;
  DateTime? cursor, lastCandle;
  bool gapReset = false;
  void reset() {
    calculator.reset();
    detector.reset();
    gapReset = true;
  }
}

class AtrEngine {
  AtrEngine({
    required this.config,
    required this.cache,
    required this.now,
    required this.elapsed,
    this.onLog,
  }) {
    _states = {
      for (final symbol in config.symbols) symbol: _SymbolState(config),
    };
    _scheduler = MinuteScheduler(now: now, onMinute: runCycle);
  }
  final AtrConfig config;
  final TickCache cache;
  final Now now;

  /// Monotonic elapsed time, e.g. () => stopwatch.elapsed. Injectable in tests.
  final Duration Function() elapsed;
  final LogSink? onLog;
  final EngineMetrics metrics = EngineMetrics();
  final _results = StreamController<AtrResult>.broadcast();
  final _alerts = StreamController<VolatilityAlert>.broadcast();
  late final Map<String, _SymbolState> _states;
  late final MinuteScheduler _scheduler;
  bool _busy = false, _disposed = false;
  bool _resumePending = false;
  int _generation = 0;
  Stream<AtrResult> get results => _results.stream;
  Stream<VolatilityAlert> get alerts => _alerts.stream;

  /// Can also be passed to the cache to count ingestion rejections.
  void recordLog(EngineLog event) {
    if (const {
      'invalidTimestamp',
      'invalidPrice',
      'duplicate',
      'outOfOrder',
      'expired',
      'unknownSymbol',
      'late',
      'wrongSymbol',
    }.contains(event.code)) {
      metrics.discard(event.code, event.count);
    }
    // A diagnostic sink must never interrupt processing of market data.
    try {
      onLog?.call(event);
    } on Object {
      /* User logging is best effort. */
    }
  }

  void start() {
    if (_disposed) {
      throw StateError('Engine disposed');
    }
    _scheduler.start();
  }

  void pause() {
    _scheduler.stop();
    _generation++;
    _resumePending = false;
  }

  void stop() => pause();
  Future<void> resume() async {
    start();
    if (_busy) {
      _resumePending = true;
      metrics.skippedCycles++;
      return;
    }
    await runCycle();
  }

  Future<void> runCycle() async {
    if (_disposed) {
      return;
    }
    if (_busy) {
      metrics.skippedCycles++;
      return;
    }
    _busy = true;
    final generation = _generation;
    final started = elapsed();
    final snapshotTime = now().toUtc();
    final until = minuteUtc(snapshotTime);
    metrics.cycles++;
    recordLog(const EngineLog('cycle'));
    try {
      // Independent async reads prevent one timed-out symbol delaying the others.
      await Future.wait(
        config.symbols.map((symbol) async {
          final state = _states[symbol]!;
          final initial = until.subtract(
            Duration(minutes: config.retentionMinutes),
          );
          var from = state.cursor ?? initial;
          if (!from.isBefore(until)) {
            return;
          }
          try {
            final snapshot = await cache
                .read(symbol, from: from, until: until)
                .timeout(config.readTimeout);
            if (_disposed || generation != _generation) {
              return;
            }
            final coverage = snapshot.coverageStart;
            if (coverage != null && coverage.isAfter(from)) {
              recordLog(
                EngineLog(
                  'coverageLost',
                  symbol: symbol,
                  count: coverage.difference(from).inMinutes,
                ),
              );
              // Never build an OHLC from a partially evicted minute.
              from = coverage;
            }
            final aggregation = CandleAggregator().aggregate(
              snapshot.ticks,
              symbol: symbol,
              from: from,
              until: until,
              now: snapshotTime,
            );
            aggregation.discarded.forEach(
              (reason, count) =>
                  recordLog(EngineLog(reason, symbol: symbol, count: count)),
            );
            if (aggregation.candles.isEmpty) {
              recordLog(EngineLog('emptyCache', symbol: symbol));
            }
            for (final candle in aggregation.candles) {
              _checkGap(symbol, state, candle.minute);
              final calculator = state.calculator.copy();
              final detector = state.detector.copy();
              final value = calculator.add(candle);
              final detection = value == null
                  ? null
                  : detector.add(value, candle.minute);
              final result = AtrResult(
                symbol: symbol,
                minute: candle.minute,
                emittedAt: snapshotTime,
                atr: value,
                baseline: detection?.baseline,
                status: value == null
                    ? DataStatus.insufficientData
                    : detection?.baseline == null
                    ? DataStatus.baselineWarmingUp
                    : DataStatus.ready,
              );
              state.calculator = calculator;
              state.detector = detector;
              state.lastCandle = candle.minute;
              state.gapReset = false;
              // Commit completed candles so a later arithmetic error cannot replay them.
              state.cursor = candle.minute.add(const Duration(minutes: 1));
              _results.add(result);
              if (detection?.alert ?? false) {
                metrics.alerts++;
                _alerts.add(VolatilityAlert(result, config.threshold));
                recordLog(EngineLog('alert', symbol: symbol));
              }
            }
            _checkGap(symbol, state, until);
            if (aggregation.candles.isEmpty ||
                (state.lastCandle != null &&
                    until.difference(state.lastCandle!).inMinutes > 1)) {
              _results.add(
                AtrResult(
                  symbol: symbol,
                  minute: until,
                  emittedAt: snapshotTime,
                  status: state.lastCandle == null || state.gapReset
                      ? DataStatus.insufficientData
                      : DataStatus.gap,
                ),
              );
            }
            state.cursor = until;
          } on Object catch (error) {
            if (_disposed || generation != _generation) {
              return;
            }
            metrics.failures++;
            recordLog(
              EngineLog('cacheOrProcessingError', symbol: symbol, error: error),
            );
            _results.add(
              AtrResult(
                symbol: symbol,
                minute: until,
                emittedAt: snapshotTime,
                status: DataStatus.cacheError,
              ),
            );
          }
        }),
      );
    } finally {
      metrics.lastDuration = elapsed() - started;
      _busy = false;
      if (_resumePending && !_disposed) {
        _resumePending = false;
        unawaited(runCycle());
      }
    }
  }

  void _checkGap(String symbol, _SymbolState state, DateTime next) {
    final last = state.lastCandle;
    if (last == null) {
      return;
    }
    final missing = next.difference(last).inMinutes - 1;
    if (missing > 0) {
      recordLog(EngineLog('gap', symbol: symbol, count: missing));
    }
    if (missing > config.maxGapMinutes && !state.gapReset) {
      state.reset();
      metrics.resets++;
      recordLog(EngineLog('reset', symbol: symbol, count: missing));
    }
  }

  Future<void> dispose() async {
    if (_disposed) {
      return;
    }
    stop();
    _disposed = true;
    await Future.wait([_results.close(), _alerts.close()]);
  }
}
