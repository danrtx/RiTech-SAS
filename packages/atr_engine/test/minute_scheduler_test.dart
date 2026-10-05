import 'dart:async';
import 'package:atr_engine/atr_engine.dart';
import 'package:fake_async/fake_async.dart';
import 'package:test/test.dart';
import 'support/helpers.dart';

void main() {
  test(
    'resume during cancelled read queues immediate recovery without overlap',
    () {
      fakeAsync((async) {
        final pending = Completer<TickSnapshot>();
        var first = true;
        final cache = StubCache((s, f, u) {
          if (first) {
            first = false;
            return pending.future;
          }
          return Future.value(TickSnapshot([tick(0, 10)]));
        });
        final engine = AtrEngine(
          config: AtrConfig(symbols: ['A'], period: 1),
          cache: cache,
          now: () => epoch.add(const Duration(minutes: 1)).add(async.elapsed),
          elapsed: () => async.elapsed,
        );
        final results = <AtrResult>[];
        final sub = engine.results.listen(results.add);
        unawaited(engine.runCycle());
        engine.pause();
        unawaited(engine.resume());
        expect(cache.reads, 1);
        pending.complete(TickSnapshot([tick(0, 999)]));
        async.flushMicrotasks();
        expect(cache.reads, 2);
        expect(results.length, 1);
        expect(results.single.atr, 0);
        unawaited(engine.dispose());
        unawaited(sub.cancel());
        async.flushMicrotasks();
      });
    },
  );
  test(
    'aligned first minute, 60 seconds thereafter, no drift and idempotent start',
    () {
      fakeAsync((async) {
        final start = epoch.add(const Duration(seconds: 27));
        final times = <DateTime>[];
        final cache = StubCache((s, f, u) async {
          times.add(start.add(async.elapsed));
          await Future<void>.delayed(const Duration(seconds: 7));
          return TickSnapshot([]);
        });
        final engine = AtrEngine(
          config: AtrConfig(symbols: ['A']),
          cache: cache,
          now: () => start.add(async.elapsed),
          elapsed: () => async.elapsed,
        );
        engine.start();
        engine.start();
        async.elapse(const Duration(seconds: 32));
        expect(times, isEmpty);
        async.elapse(const Duration(seconds: 1));
        expect(times.single, epoch.add(const Duration(minutes: 1)));
        async.elapse(const Duration(minutes: 10));
        expect(times.length, 11);
        for (var i = 0; i < times.length; i++) {
          expect(times[i], epoch.add(Duration(minutes: i + 1)));
        }
        engine.stop();
        async.elapse(const Duration(seconds: 8));
        expect(engine.metrics.lastDuration, const Duration(seconds: 7));
        unawaited(engine.dispose());
        async.flushMicrotasks();
        expect(async.nonPeriodicTimerCount, 0);
      });
    },
  );
  test('long cycle cannot overlap; next tick recovers skipped minutes', () {
    fakeAsync((async) {
      final pending = Completer<TickSnapshot>();
      var first = true;
      final intervals = <(DateTime, DateTime)>[];
      final cache = StubCache((s, f, u) {
        intervals.add((f, u));
        if (first) {
          first = false;
          return pending.future;
        }
        return Future.value(TickSnapshot([]));
      });
      final engine = AtrEngine(
        config: AtrConfig(
          symbols: ['A'],
          readTimeout: const Duration(minutes: 5),
        ),
        cache: cache,
        now: () => epoch.add(async.elapsed),
        elapsed: () => async.elapsed,
      );
      engine.start();
      async.elapse(const Duration(minutes: 2));
      expect(cache.reads, 1);
      expect(engine.metrics.skippedCycles, 1);
      pending.complete(TickSnapshot([]));
      async.flushMicrotasks();
      async.elapse(const Duration(minutes: 1));
      expect(intervals.last, (
        epoch.add(const Duration(minutes: 1)),
        epoch.add(const Duration(minutes: 3)),
      ));
      unawaited(engine.dispose());
      async.flushMicrotasks();
    });
  });
  test('timeout isolates symbol, retries, ignores late response', () {
    fakeAsync((async) {
      final pending = Completer<TickSnapshot>();
      var first = true;
      final engine = AtrEngine(
        config: AtrConfig(symbols: ['A', 'B'], period: 1),
        cache: StubCache((s, f, u) {
          if (s == 'A' && first) {
            first = false;
            return pending.future;
          }
          return Future.value(TickSnapshot([tick(0, 10, symbol: s)]));
        }),
        now: () => epoch.add(const Duration(minutes: 1)).add(async.elapsed),
        elapsed: () => async.elapsed,
      );
      final results = <AtrResult>[];
      final sub = engine.results.listen(results.add);
      unawaited(engine.runCycle());
      async.flushMicrotasks();
      expect(results.single.symbol, 'B');
      async.elapse(const Duration(seconds: 10));
      expect(engine.metrics.failures, 1);
      pending.complete(TickSnapshot([tick(0, 999)]));
      async.flushMicrotasks();
      unawaited(engine.runCycle());
      async.flushMicrotasks();
      expect(results.where((r) => r.symbol == 'A' && r.atr != null).length, 1);
      unawaited(engine.dispose());
      unawaited(sub.cancel());
      async.flushMicrotasks();
    });
  });
  test(
    'pause and resume recovers all cached closed candles without false gap',
    () {
      fakeAsync((async) {
        final cache = StubCache(
          (s, f, u) async => TickSnapshot(
            [for (var i = 0; i < 6; i++) tick(i, 10)].where(
              (t) => !t.timestamp!.isBefore(f) && t.timestamp!.isBefore(u),
            ),
          ),
        );
        final engine = AtrEngine(
          config: AtrConfig(symbols: ['A'], period: 2, maxGapMinutes: 1),
          cache: cache,
          now: () => epoch.add(async.elapsed),
          elapsed: () => async.elapsed,
        );
        final results = <AtrResult>[];
        final sub = engine.results.listen(results.add);
        engine.start();
        async.elapse(const Duration(minutes: 1));
        engine.pause();
        async.elapse(const Duration(minutes: 5));
        expect(cache.reads, 1);
        unawaited(engine.resume());
        async.flushMicrotasks();
        expect(results.length, 6);
        expect(engine.metrics.resets, 0);
        unawaited(engine.dispose());
        unawaited(sub.cancel());
        async.flushMicrotasks();
      });
    },
  );
  test('wall clock jumps do not duplicate committed candles and realign', () {
    fakeAsync((async) {
      var offset = Duration.zero;
      final cache = StubCache((s, f, u) async => TickSnapshot([]));
      final engine = AtrEngine(
        config: AtrConfig(symbols: ['A']),
        cache: cache,
        now: () => epoch.add(async.elapsed + offset),
        elapsed: () => async.elapsed,
      );
      engine.start();
      async.elapse(const Duration(minutes: 1));
      offset = const Duration(minutes: -2);
      async.elapse(const Duration(minutes: 1));
      expect(cache.reads, 1);
      offset = const Duration(minutes: 5, seconds: 15);
      async.elapse(const Duration(minutes: 1));
      expect(cache.reads, 2);
      async.elapse(const Duration(seconds: 45));
      expect(cache.reads, 3);
      unawaited(engine.dispose());
      async.flushMicrotasks();
    });
  });
}
