import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/features/investment/investment_api.dart';
import 'package:ritech_mobile/features/investment/investment_screen.dart';

class FakeInvestmentApi extends InvestmentApi {
  FakeInvestmentApi({this.status = 'READY', this.expired = false});
  final String status;
  final bool expired;
  int requests = 0;
  String? decision;
  @override
  Future<Map<String, dynamic>> recommend(int quantity, String key) async {
    requests++;
    return {
      'id': 'test-id',
      'status': status,
      'decision': status == 'NO_DISPONIBLE' ? null : 'ABSTENERSE',
      'validUntil':
          DateTime.now().millisecondsSinceEpoch + (expired ? -1000 : 60000),
      'generatedAt': DateTime.now().millisecondsSinceEpoch,
      'justification': 'No hay capital ni posiciones verificables.',
      'horizon': 'ANALISIS_GENERAL_INTRADIA',
      'riskValidation': {
        'passed': false,
        'reasons': ['CONTEXTO_FINANCIERO_AUSENTE']
      },
      'indicators': {'price': 100, 'atr': 0.5},
      'uncertainty': 'ALTA'
    };
  }

  @override
  Future<Map<String, dynamic>> ask(
          String id, String question, String key) async =>
      {
        'answer': 'QQQ es un ETF, NDX es un índice.',
        'requiresNewEvaluation': false
      };
  @override
  Future<Map<String, dynamic>> decide(String id, String value) async {
    decision = value;
    return {'decision': value};
  }
}

void main() {
  test(
      'request IDs are distinct UUIDs and errors do not expose provider payloads',
      () {
    expect(requestId(), matches(RegExp(r'^[a-f0-9-]{36}$')));
    expect(requestId(), isNot(requestId()));
    expect(investmentError(StateError('secret')), isNot(contains('secret')));
  });
  testWidgets(
      'general panel requests analysis without users or roles and records a decision',
      (tester) async {
    final api = FakeInvestmentApi();
    await tester.pumpWidget(MaterialApp(home: InvestmentScreen(api: api)));
    expect(find.text('Iniciar sesión'), findsNothing);
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    expect(find.text('ABSTENERSE'), findsOneWidget);
    expect(api.requests, 1);
    await tester
        .ensureVisible(find.text('¿Qué diferencia hay entre NDX y QQQ?'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('¿Qué diferencia hay entre NDX y QQQ?'));
    await tester.pumpAndSettle();
    expect(find.textContaining('QQQ es un ETF, NDX es un índice.'),
        findsOneWidget);
    await tester.ensureVisible(find.text('POSPONER'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('POSPONER'));
    await tester.pumpAndSettle();
    expect(api.decision, 'POSPONER');
    expect(
        find.textContaining('Decisión registrada: POSPONER'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  for (final status in ['DATOS_INSUFICIENTES', 'NO_DISPONIBLE']) {
    testWidgets('renders $status safely', (tester) async {
      await tester.pumpWidget(MaterialApp(
          home: InvestmentScreen(api: FakeInvestmentApi(status: status))));
      await tester.tap(find.text('Solicitar recomendación'));
      await tester.pumpAndSettle();
      expect(
          find.text(status == 'NO_DISPONIBLE'
              ? 'Servicio no disponible'
              : 'Datos insuficientes · ABSTENERSE'),
          findsOneWidget);
      expect(find.textContaining('ninguna orden solicitada'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });
  }
  testWidgets('validates quantity and displays expiration', (tester) async {
    final api = FakeInvestmentApi(expired: true);
    await tester.pumpWidget(MaterialApp(home: InvestmentScreen(api: api)));
    await tester.enterText(find.byType(TextField).first, '0');
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    expect(api.requests, 0);
    expect(find.textContaining('entero positivo'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '1');
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Recomendación vencida'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
