import 'package:atr_engine/atr_engine.dart';
import 'package:test/test.dart';
import 'support/helpers.dart';

void main() {
  test('timestamp parser rejects calendar overflow and missing timezone', () {
    for (final timestamp in [
      '2026-02-30T12:00:00Z',
      '2026-10-04T25:00:00Z',
      '2026-10-04T12:00:00',
      '2026-10-04T12:00:00+25:00',
    ]) {
      expect(
        Tick.parse(symbol: 'A', price: 1, timestamp: timestamp).timestamp,
        isNull,
      );
    }
    expect(
      Tick.parse(
        symbol: 'A',
        price: 1,
        timestamp: '2026-10-04T07:00:00-05:00',
      ).timestamp,
      epoch,
    );
  });
  Aggregation aggregate(List<Tick> ticks) => CandleAggregator().aggregate(
    ticks,
    symbol: 'A',
    from: epoch,
    until: epoch.add(const Duration(minutes: 2)),
    now: epoch.add(const Duration(minutes: 2, seconds: 30)),
  );
  test('UTC OHLC, boundary and open candle excluded', () {
    final result = aggregate([
      tick(0, 10),
      tick(0, 14, second: 5),
      tick(0, 9, second: 20),
      tick(0, 12, second: 59),
      tick(1, 20),
      tick(2, 100),
    ]);
    expect(result.candles.length, 2);
    final c = result.candles.first;
    expect([c.open, c.high, c.low, c.close], [10, 14, 9, 12]);
    expect(c.minute, epoch);
    expect(minuteUtc(DateTime.parse('2026-10-04T07:00:59-05:00')), epoch);
    expect(result.discarded, isEmpty);
  });
  for (final price in <double?>[
    null,
    0,
    -1,
    double.nan,
    double.infinity,
    double.negativeInfinity,
  ]) {
    test('reject price $price', () {
      expect(aggregate([tick(0, price)]).discarded, {'invalidPrice': 1});
    });
  }
  test('invalid parsed and future timestamps', () {
    expect(
      aggregate([
        Tick.parse(symbol: 'A', price: 2, timestamp: 'invalid'),
        tick(3, 2),
      ]).discarded,
      {'invalidTimestamp': 2},
    );
  });
  test('duplicate IDs and fallback identity', () {
    expect(
      aggregate([
        tick(0, 10, id: 'x'),
        tick(0, 11, id: 'x'),
        tick(1, 12),
        tick(1, 12),
      ]).discarded,
      {'duplicate': 2},
    );
  });
  test('out of order discarded, equal timestamp distinct prices accepted', () {
    final result = aggregate([
      tick(0, 10, second: 10),
      tick(0, 20, second: 2),
      tick(0, 12, second: 10),
    ]);
    expect(result.discarded, {'outOfOrder': 1});
    expect(result.candles.single.high, 12);
  });
  test('late ticks and wrong symbol counted', () {
    expect(aggregate([tick(-1, 10), tick(0, 10, symbol: 'B')]).discarded, {
      'late': 1,
      'wrongSymbol': 1,
    });
  });
  test('empty minutes do not fabricate candles', () {
    expect(
      aggregate([tick(1, 10)]).candles.single.minute,
      epoch.add(const Duration(minutes: 1)),
    );
    expect(aggregate([]).candles, isEmpty);
  });
}
