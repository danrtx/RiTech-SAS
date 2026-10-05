import 'package:atr_engine/atr_engine.dart';
import 'package:atr_engine_flutter/atr_engine_flutter.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('observer pauses, recovers on resume, unregisters on dispose', (
    tester,
  ) async {
    final start = DateTime.utc(2026, 10, 4, 12);
    var now = start;
    final config = AtrConfig(symbols: ['A']);
    final cache = InMemoryTickCache(now: () => now, config: config);
    final engine = AtrEngine(
      config: config,
      cache: cache,
      now: () => now,
      elapsed: () => now.difference(start),
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final observer = AtrLifecycleObserver(engine, binding: tester.binding);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    now = start.add(const Duration(minutes: 10));
    await tester.pump(const Duration(minutes: 10));
    expect(engine.metrics.cycles, 0);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(engine.metrics.cycles, 1);
    observer.dispose();
    observer.dispose();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(const Duration(minutes: 1));
    expect(engine.metrics.cycles, 1);
    await engine.dispose();
  });
}
