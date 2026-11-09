import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/features/investment/simulation_account_form.dart';

void main() {
  testWidgets(
      'validates balances, holdings and limits before submitting a scenario',
      (tester) async {
    final key = GlobalKey<SimulationAccountFormState>();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
      child: SimulationAccountForm(key: key, enabled: true),
    ))));
    expect(key.currentState!.read(),
        isNull); // Stop-loss must be explicitly supplied.
    final state = key.currentState!;
    state.controllers['stopLoss']!.text = '95,5';
    expect(state.read(), containsPair('stopLoss', 95.5));
    for (final entry in {
      'cash': '-1',
      'quantity': '1.5',
      'maxAtrPercent': '101',
      'maxInstrumentExposure': '6000',
      'stopLoss': 'NaN'
    }.entries) {
      final previous = state.controllers[entry.key]!.text;
      state.controllers[entry.key]!.text = entry.value;
      expect(state.read(), isNull, reason: entry.key);
      state.controllers[entry.key]!.text = previous;
    }
    state.controllers['quantity']!.text = '2';
    expect(state.read(), isNull); // Holdings need a valid average entry.
    state.controllers['averageEntry']!.text = '90';
    expect(state.read()?['position'], {'quantity': 2, 'averageEntry': 90.0});
    await tester.pumpWidget(const SizedBox());
  });
}
