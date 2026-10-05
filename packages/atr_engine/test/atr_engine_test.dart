import 'dart:async';
import 'package:atr_engine/atr_engine.dart';
import 'package:test/test.dart';
import 'support/helpers.dart';

void main() {
  test(
    'recovered history followed by long empty tail publishes reset status',
    () async {
      final engine = AtrEngine(
        config: AtrConfig(symbols: ['A'], period: 1, maxGapMinutes: 2),
        cache: StubCache((s, f, u) async => TickSnapshot([tick(0, 10)])),
        now: () => epoch.add(const Duration(minutes: 10)),
        elapsed: () => Duration.zero,
      );
      final results = <AtrResult>[];
      final sub = engine.results.listen(results.add);
      await engine.runCycle();
      await engine.dispose();
      await sub.cancel();
      expect(results.length, 2);
      expect(results.first.atr, 0);
      expect(results.last.status, DataStatus.insufficientData);
      expect(results.last.atr, isNull);
      expect(engine.metrics.resets, 1);
    },
  );
  test('warm-up, alert stream, incremental reads and counters', () async {
    var current = epoch.add(const Duration(minutes: 4));
    final logs = <EngineLog>[];
    final cache = StubCache(
      (s, f, u) async => TickSnapshot(
        [
          for (var i = 0; i < 4; i++) ...[
            tick(i, 10),
            tick(i, i == 3 ? 20 : 12, second: 30),
          ],
        ].where((t) => !t.timestamp!.isBefore(f) && t.timestamp!.isBefore(u)),
      ),
    );
    final engine = AtrEngine(
      config: AtrConfig(symbols: ['A'], period: 2, baselineWindow: 1),
      cache: cache,
      now: () => current,
      elapsed: () => Duration.zero,
      onLog: logs.add,
    );
    final results = <AtrResult>[];
    final alerts = <VolatilityAlert>[];
    final sub = engine.results.listen(results.add);
    final alertSub = engine.alerts.listen(alerts.add);
    await engine.runCycle();
    await Future<void>.delayed(Duration.zero);
    expect(results.map((r) => r.status), [
      DataStatus.insufficientData,
      DataStatus.baselineWarmingUp,
      DataStatus.ready,
      DataStatus.ready,
    ]);
    expect(results.last.atr, 6);
    expect(alerts.single.result.minute, epoch.add(const Duration(minutes: 3)));
    expect(engine.metrics.alerts, 1);
    await engine.runCycle();
    await Future<void>.delayed(Duration.zero);
    expect(cache.reads, 1);
    current = current.add(const Duration(minutes: 1));
    await engine.runCycle();
    await Future<void>.delayed(Duration.zero);
    expect(results.last.status, DataStatus.gap);
    expect(logs.any((l) => l.code == 'emptyCache'), isTrue);
    await engine.dispose();
    await sub.cancel();
    await alertSub.cancel();
  });
  for (final gap in [2, 3]) {
    test(
      'gap $gap with K=2 ${gap == 2 ? "preserves" : "resets"} Wilder',
      () async {
        final now = epoch.add(Duration(minutes: gap + 2));
        final cache = StubCache(
          (s, f, u) async => TickSnapshot([
            tick(0, 10),
            tick(0, 12, second: 30),
            tick(gap + 1, 20),
            tick(gap + 1, 22, second: 30),
          ]),
        );
        final engine = AtrEngine(
          config: AtrConfig(
            symbols: ['A'],
            period: 2,
            baselineWindow: 1,
            maxGapMinutes: 2,
          ),
          cache: cache,
          now: () => now,
          elapsed: () => Duration.zero,
        );
        final results = <AtrResult>[];
        final sub = engine.results.listen(results.add);
        await engine.runCycle();
        await Future<void>.delayed(Duration.zero);
        expect(results.last.atr, gap == 2 ? 6 : isNull);
        expect(engine.metrics.resets, gap == 2 ? 0 : 1);
        await engine.dispose();
        await sub.cancel();
      },
    );
  }
  test(
    'long empty tail resets once and retries empty cache every cycle',
    () async {
      var now = epoch.add(const Duration(minutes: 1));
      final cache = StubCache(
        (s, f, u) async => TickSnapshot(f.isAfter(epoch) ? [] : [tick(0, 10)]),
      );
      final engine = AtrEngine(
        config: AtrConfig(symbols: ['A'], period: 1, maxGapMinutes: 2),
        cache: cache,
        now: () => now,
        elapsed: () => Duration.zero,
      );
      final results = <AtrResult>[];
      final sub = engine.results.listen(results.add);
      await engine.runCycle();
      await Future<void>.delayed(Duration.zero);
      now = epoch.add(const Duration(minutes: 4));
      await engine.runCycle();
      await Future<void>.delayed(Duration.zero);
      expect(engine.metrics.resets, 1);
      expect(results.last.status, DataStatus.insufficientData);
      now = epoch.add(const Duration(minutes: 5));
      await engine.runCycle();
      await Future<void>.delayed(Duration.zero);
      expect(engine.metrics.resets, 1);
      expect(cache.reads, 3);
      await engine.dispose();
      await sub.cancel();
    },
  );
  test('empty from startup emits InsufficientData', () async {
    final engine = AtrEngine(
      config: AtrConfig(symbols: ['A']),
      cache: StubCache((s, f, u) async => TickSnapshot([])),
      now: () => epoch,
      elapsed: () => Duration.zero,
    );
    final results = <AtrResult>[];
    final sub = engine.results.listen(results.add);
    await engine.runCycle();
    await Future<void>.delayed(Duration.zero);
    expect(results.single.status, DataStatus.insufficientData);
    expect(results.single.atr, isNull);
    await engine.dispose();
    await sub.cancel();
  });
  test(
    'one symbol read failure does not block another, failed cursor retries',
    () async {
      var fail = true;
      final starts = <DateTime>[];
      final cache = StubCache((s, f, u) async {
        if (s == 'A') {
          starts.add(f);
          if (fail) {
            throw StateError('offline');
          }
        }
        return TickSnapshot([tick(0, 10, symbol: s)]);
      });
      final engine = AtrEngine(
        config: AtrConfig(symbols: ['A', 'B'], period: 1),
        cache: cache,
        now: () => epoch.add(const Duration(minutes: 1)),
        elapsed: () => Duration.zero,
      );
      final results = <AtrResult>[];
      final sub = engine.results.listen(results.add);
      await engine.runCycle();
      await Future<void>.delayed(Duration.zero);
      expect(results.any((r) => r.symbol == 'B' && r.atr == 0), isTrue);
      expect(engine.metrics.failures, 1);
      fail = false;
      await engine.runCycle();
      await Future<void>.delayed(Duration.zero);
      expect(starts[1], starts[0]);
      expect(results.last.symbol, 'A');
      expect(results.last.atr, 0);
      await engine.dispose();
      await sub.cancel();
    },
  );
  test('discard metrics and throwing logger cannot break processing', () async {
    final engine = AtrEngine(
      config: AtrConfig(symbols: ['A'], period: 1),
      cache: StubCache(
        (s, f, u) async =>
            TickSnapshot([tick(0, null), tick(0, 10), tick(0, 10)]),
      ),
      now: () => epoch.add(const Duration(minutes: 1)),
      elapsed: () => Duration.zero,
      onLog: (_) => throw StateError('logger broken'),
    );
    await engine.runCycle();
    await Future<void>.delayed(Duration.zero);
    expect(engine.metrics.discarded, {'invalidPrice': 1, 'duplicate': 1});
    expect(engine.metrics.failures, 0);
    await engine.dispose();
  });
  test(
    'coverage loss excludes partial candle and resets after long gap',
    () async {
      var now = epoch.add(const Duration(minutes: 1));
      var lost = false;
      final logs = <EngineLog>[];
      final engine = AtrEngine(
        config: AtrConfig(symbols: ['A'], period: 2, maxGapMinutes: 1),
        cache: StubCache(
          (s, f, u) async => lost
              ? TickSnapshot([
                  tick(3, 100),
                  tick(4, 10),
                ], coverageStart: epoch.add(const Duration(minutes: 4)))
              : TickSnapshot([tick(0, 10)]),
        ),
        now: () => now,
        elapsed: () => Duration.zero,
        onLog: logs.add,
      );
      final results = <AtrResult>[];
      final sub = engine.results.listen(results.add);
      await engine.runCycle();
      await Future<void>.delayed(Duration.zero);
      lost = true;
      now = epoch.add(const Duration(minutes: 5));
      await engine.runCycle();
      await Future<void>.delayed(Duration.zero);
      expect(engine.metrics.resets, 1);
      expect(results.last.atr, isNull);
      expect(logs.any((e) => e.code == 'coverageLost'), isTrue);
      await engine.dispose();
      await sub.cancel();
    },
  );
  test('dispose prevents publications from in-flight reads', () async {
    final pending = Completer<TickSnapshot>();
    final engine = AtrEngine(
      config: AtrConfig(symbols: ['A']),
      cache: StubCache((s, f, u) => pending.future),
      now: () => epoch,
      elapsed: () => Duration.zero,
    );
    final results = <AtrResult>[];
    final sub = engine.results.listen(results.add);
    final cycle = engine.runCycle();
    await engine.dispose();
    pending.complete(TickSnapshot([tick(-1, 10)]));
    await cycle;
    expect(results, isEmpty);
    expect(() => engine.start(), throwsStateError);
    await sub.cancel();
  });
}
