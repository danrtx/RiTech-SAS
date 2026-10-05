import 'package:atr_engine/atr_engine.dart';
import 'package:test/test.dart';
import 'support/helpers.dart';

void main() {
  test(
    'ticks arriving after snapshot closed their minute are counted as late',
    () async {
      var now = epoch.add(const Duration(seconds: 30));
      final logs = <EngineLog>[];
      final cache = InMemoryTickCache(
        now: () => now,
        config: AtrConfig(symbols: ['A']),
        onLog: logs.add,
      );
      cache.add(tick(0, 10));
      now = epoch.add(const Duration(minutes: 1));
      await cache.read('A', from: epoch, until: now);
      expect(cache.add(tick(0, 20, second: 59)), isFalse);
      expect(logs.last.code, 'late');
      expect(cache.add(tick(1, 20)), isTrue);
    },
  );
  test('JSON config and immutable symbols', () {
    final config = AtrConfig.fromJson({
      'symbols': ['A'],
      'threshold': 2,
    });
    expect(config.period, 14);
    expect(config.threshold, 2);
    expect(() => config.symbols.add('B'), throwsUnsupportedError);
    expect(() => AtrConfig(symbols: []), throwsArgumentError);
    expect(
      () => AtrConfig(symbols: ['A'], threshold: double.nan),
      throwsArgumentError,
    );
    expect(
      () => AtrConfig(symbols: ['A'], retentionMinutes: 2),
      throwsArgumentError,
    );
    expect(
      () => AtrConfig(symbols: ['A'], readTimeout: Duration.zero),
      throwsArgumentError,
    );
  });
  test(
    'cache ingestion validates across reads and returns immutable snapshot',
    () async {
      final logs = <EngineLog>[];
      final cache = InMemoryTickCache(
        now: () => epoch.add(const Duration(minutes: 2)),
        config: AtrConfig(symbols: ['A']),
        onLog: logs.add,
      );
      expect(cache.add(tick(0, 10, id: 'a')), isTrue);
      expect(cache.add(tick(0, 20, id: 'a')), isFalse);
      expect(cache.add(tick(-1, 10)), isFalse);
      expect(cache.add(tick(3, 10)), isFalse);
      expect(cache.add(tick(1, double.nan)), isFalse);
      final snapshot = await cache.read(
        'A',
        from: epoch,
        until: epoch.add(const Duration(minutes: 1)),
      );
      expect(snapshot.ticks.length, 1);
      expect(() => snapshot.ticks.add(tick(1, 10)), throwsUnsupportedError);
      expect(logs.map((e) => e.code), [
        'duplicate',
        'outOfOrder',
        'invalidTimestamp',
        'invalidPrice',
      ]);
    },
  );
  test('capacity eviction marks partial minute unavailable', () async {
    final cache = InMemoryTickCache(
      now: () => epoch.add(const Duration(minutes: 2)),
      config: AtrConfig(symbols: ['A'], maxTicks: 2),
    );
    cache.add(tick(0, 10));
    cache.add(tick(0, 12, second: 20));
    cache.add(tick(1, 11));
    final snapshot = await cache.read(
      'A',
      from: epoch,
      until: epoch.add(const Duration(minutes: 2)),
    );
    expect(snapshot.ticks.length, 2);
    expect(snapshot.coverageStart, epoch.add(const Duration(minutes: 1)));
  });
  test('time retention prunes on read', () async {
    var now = epoch;
    final cache = InMemoryTickCache(
      now: () => now,
      config: AtrConfig(
        symbols: ['A'],
        period: 1,
        baselineWindow: 1,
        retentionMinutes: 2,
      ),
    );
    cache.add(tick(0, 10));
    now = epoch.add(const Duration(minutes: 3));
    final snapshot = await cache.read('A', from: epoch, until: now);
    expect(snapshot.ticks, isEmpty);
    expect(snapshot.coverageStart, epoch.add(const Duration(minutes: 1)));
  });
}
