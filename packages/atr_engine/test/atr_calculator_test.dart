import 'package:atr_engine/atr_engine.dart';
import 'package:test/test.dart';
import 'support/helpers.dart';

void main() {
  test('seed includes first range, previous close gap, Wilder and reset', () {
    final calculator = AtrCalculator(3);
    expect(calculator.add(candle(0)), isNull); // TR 2, close 11
    expect(
      calculator.add(candle(1, low: 15, high: 17, close: 16)),
      isNull,
    ); // TR 6
    expect(
      calculator.add(candle(2, low: 10, high: 12, close: 11)),
      closeTo(14 / 3, 1e-12),
    ); // TR 6
    expect(calculator.add(candle(3)), closeTo((14 / 3 * 2 + 2) / 3, 1e-12));
    calculator.reset();
    expect(calculator.add(candle(4)), isNull);
  });
  test('period one', () {
    final calculator = AtrCalculator(1);
    expect(calculator.add(candle(0)), 2);
    expect(calculator.add(candle(1, low: 15, high: 17, close: 16)), 6);
  });
  test('reject invalid period and candle', () {
    expect(() => AtrCalculator(0), throwsArgumentError);
    expect(() => candle(0, high: double.infinity), throwsArgumentError);
  });
}
