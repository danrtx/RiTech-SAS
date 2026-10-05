import 'dart:convert';
import 'dart:io';
import 'package:atr_engine/atr_engine.dart';
import 'package:clock/clock.dart';

Future<void> main() async {
  final json =
      jsonDecode(await File('example/config.json').readAsString())
          as Map<String, Object?>;
  final config = AtrConfig.fromJson(json);
  final stopwatch = Stopwatch()..start();
  late final AtrEngine engine;
  final cache = InMemoryTickCache(
    now: clock.now,
    config: config,
    onLog: (event) => engine.recordLog(event),
  );
  engine = AtrEngine(
    config: config,
    cache: cache,
    now: clock.now,
    elapsed: () => stopwatch.elapsed,
    onLog: (event) => stdout.writeln(
      '${event.code}: ${event.symbol ?? "all"} (${event.count})',
    ),
  );
  final results = engine.results.listen(
    (r) => stdout.writeln(
      '${r.symbol} ${r.minute.toIso8601String()} ${r.status.name} ATR=${r.atr} base=${r.baseline}',
    ),
  );
  final alerts = engine.alerts.listen(
    (a) => stdout.writeln('VOLATILITY ${a.result.symbol}'),
  );
  final boundary = minuteUtc(clock.now());
  // Synthetic history only; replace with ticks delivered by your backend API.
  for (var index = 40; index > 0; index--) {
    for (final symbol in config.symbols) {
      final start = boundary.subtract(Duration(minutes: index));
      cache.add(Tick(symbol: symbol, price: 100, timestamp: start));
      cache.add(
        Tick(
          symbol: symbol,
          price: index == 1 ? 120 : 101,
          timestamp: start.add(const Duration(seconds: 30)),
        ),
      );
    }
  }
  await engine.runCycle();
  // In a long-running host use engine.start(), pause(), resume(), then dispose().
  await engine.dispose();
  await results.cancel();
  await alerts.cancel();
}
