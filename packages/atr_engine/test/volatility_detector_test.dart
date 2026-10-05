import 'package:atr_engine/atr_engine.dart';
import 'package:test/test.dart';
import 'support/helpers.dart';

void main() {
  final detector = VolatilityDetector(AtrConfig(symbols: ['A']));
  test('below, exact and above 1.5x', () {
    expect(detector.exceeds(14.999999, 10), isFalse);
    expect(detector.exceeds(15, 10), isTrue);
    expect(detector.exceeds(15.000001, 10), isTrue);
  });
  test('relative epsilon band at multiple scales', () {
    for (final scale in [1e-9, 1.0, 1e9]) {
      expect(detector.exceeds(15 * scale * (1 - 5e-13), 10 * scale), isTrue);
      expect(detector.exceeds(15 * scale * (1 - 2e-12), 10 * scale), isFalse);
    }
  });
  test('changing threshold changes outcome', () {
    expect(
      VolatilityDetector(
        AtrConfig(symbols: ['A'], threshold: 2),
      ).exceeds(15, 10),
      isFalse,
    );
  });
  test('baseline excludes current, warm-up and rolling window', () {
    final d = VolatilityDetector(AtrConfig(symbols: ['A'], baselineWindow: 2));
    expect(d.add(10, epoch).baseline, isNull);
    expect(d.add(10, epoch.add(const Duration(minutes: 1))).baseline, isNull);
    final result = d.add(15, epoch.add(const Duration(minutes: 2)));
    expect(result.baseline, 10);
    expect(result.alert, isTrue);
    expect(d.add(10, epoch.add(const Duration(minutes: 3))).baseline, 12.5);
  });
  test('zero baseline, invalid values and overflow', () {
    expect(detector.exceeds(0, 0), isFalse);
    expect(detector.exceeds(1, 0), isTrue);
    expect(() => detector.exceeds(double.nan, 1), throwsArgumentError);
    expect(() => detector.exceeds(1, 1.7e308), throwsStateError);
  });
  test('cooldown and reset', () {
    final d = VolatilityDetector(
      AtrConfig(symbols: ['A'], baselineWindow: 1, cooldownMinutes: 2),
    );
    d.add(1, epoch);
    expect(d.add(2, epoch.add(const Duration(minutes: 1))).alert, isTrue);
    expect(d.add(4, epoch.add(const Duration(minutes: 2))).alert, isFalse);
    expect(d.add(8, epoch.add(const Duration(minutes: 3))).alert, isTrue);
    d.reset();
    expect(d.add(16, epoch.add(const Duration(minutes: 4))).baseline, isNull);
  });
}
