import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/features/monitoring/presentation/widgets/profitability_chart.dart';

void main() {
  Widget chart(List<double> values) => MaterialApp(
        home: Center(
            child: SizedBox(
                width: 300,
                child: ProfitabilityChart(pnlSeries: values, height: 180))),
      );

  testWidgets('empty series shows missing data, not a fabricated return',
      (tester) async {
    await tester.pumpWidget(chart([]));
    expect(find.text('Sin datos de rentabilidad'), findsOneWidget);
  });

  for (final entry in {
    'profit': [0.0, -1.0, 3.0],
    'loss': [1.0, 0.0, -2.0],
    'flat': [0.0, 0.0, 0.0],
  }.entries) {
    testWidgets('${entry.key} renders and updates the return series',
        (tester) async {
      await tester.pumpWidget(chart([0]));
      await tester.pumpWidget(chart(entry.value));
      final paint = find.descendant(
          of: find.byType(ProfitabilityChart),
          matching: find.byType(CustomPaint));
      final expectedColor = entry.value.last >= 0
          ? const Color(0xFF42D3A5)
          : const Color(0xFFFF6B6B);
      expect(
          paint,
          paints
            ..line()
            ..path()
            ..path(color: expectedColor)
            ..circle(color: expectedColor, radius: 3));
      expect(tester.getSize(paint), const Size(300, 180));
      expect(find.text('Sin datos de rentabilidad'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
