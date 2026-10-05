import 'dart:io';
import 'package:atr_engine/atr_engine.dart';
import 'package:test/test.dart';
import 'support/helpers.dart';

void main() {
  test(
    'cached ticks through full engine match the independent reference',
    () async {
      final rows = File(
        'test/fixtures/atr_reference.csv',
      ).readAsLinesSync().skip(1).map((line) => line.split(',')).toList();
      final now = DateTime.parse(rows.last[0]).add(const Duration(minutes: 1));
      final config = AtrConfig(symbols: ['A']);
      final cache = InMemoryTickCache(now: () => now, config: config);
      for (final row in rows) {
        final minute = DateTime.parse(row[0]);
        for (var j = 1; j <= 4; j++) {
          cache.add(
            Tick(
              symbol: 'A',
              price: double.parse(row[j]),
              timestamp: minute.add(Duration(seconds: j * 10)),
            ),
          );
        }
      }
      final engine = AtrEngine(
        config: config,
        cache: cache,
        now: () => now,
        elapsed: () => Duration.zero,
      );
      final output = <AtrResult>[];
      final sub = engine.results.listen(output.add);
      await engine.runCycle();
      await engine.dispose();
      await sub.cancel();
      expect(output.length, 60);
      for (var i = 0; i < rows.length; i++) {
        expect(output[i].minute, epoch.add(Duration(minutes: i)));
        expect(
          output[i].atr,
          rows[i][6].isEmpty ? isNull : closeTo(double.parse(rows[i][6]), 1e-6),
        );
      }
    },
  );
  test(
    '60 candle Wilder ATR agrees with external pandas reference <= 1e-6',
    () {
      final lines = File('test/fixtures/atr_reference.csv').readAsLinesSync();
      final calculator = AtrCalculator(14);
      var compared = 0;
      for (final line in lines.skip(1)) {
        final cells = line.split(',');
        final value = calculator.add(
          Candle(
            minute: DateTime.parse(cells[0]).toUtc(),
            open: double.parse(cells[1]),
            high: double.parse(cells[2]),
            low: double.parse(cells[3]),
            close: double.parse(cells[4]),
          ),
        );
        if (cells[6].isEmpty) {
          expect(value, isNull);
        } else {
          expect(value, closeTo(double.parse(cells[6]), 1e-6));
          compared++;
        }
      }
      expect(compared, 47);
    },
  );
}
