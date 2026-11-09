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
  String? requestedMode;
  Map<String, dynamic>? requestedSimulation;
  @override
  Future<Map<String, dynamic>> recommend(int quantity, String key,
      {String mode = 'INTRADAY', Map<String, dynamic>? simulation}) async {
    requests++;
    requestedMode = mode;
    requestedSimulation = simulation;
    return {
      'id': 'test-id',
      'status': status,
      if (status == 'ANALISIS_INFORMATIVO') ...{
        'analysisMode': 'CLOSED_BARS_INFORMATIONAL_ONLY',
        'modelDecision': 'COMPRAR',
      },
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
      'uncertainty': 'ALTA',
      if (simulation != null) ...{
        'accountMode': 'SIMULATED',
        'simulationDecision': 'COMPRAR',
        'simulationValidation': {
          'passed': true,
          'explanation': 'Cumple el escenario ficticio.',
          'cash': simulation['cash'],
          'positionQuantity': 0,
          'estimatedBuyCost': 100.1,
          'candidates': [
            {
              'decision': 'COMPRAR',
              'allowed': true,
              'explanation': 'Cumple límites.'
            }
          ]
        },
      },
      if (mode == 'AFTER_CLOSE') ...{
        'status': 'ANALISIS_AL_CIERRE',
        'analysisMode': 'AFTER_CLOSE',
        'sessionDateNY': '2026-11-06',
        'modelDecision': 'MANTENER',
        'questionsUntil':
            DateTime.now().add(const Duration(hours: 4)).millisecondsSinceEpoch,
      }
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
  testWidgets(
      'submits fictional account and labels recommendation without an order',
      (tester) async {
    final api = FakeInvestmentApi();
    await tester.pumpWidget(MaterialApp(home: InvestmentScreen(api: api)));
    await tester.scrollUntilVisible(
        find.text('Evaluar con una cuenta simulada'), 200,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Evaluar con una cuenta simulada'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
        find.byKey(const ValueKey('simulation-stopLoss')), 200,
        scrollable: find.byType(Scrollable).first);
    await tester.enterText(
        find.byKey(const ValueKey('simulation-stopLoss')), '95');
    await tester.scrollUntilVisible(find.text('Solicitar recomendación'), 200,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    expect(api.requestedSimulation, containsPair('kind', 'SIMULATED'));
    expect(api.requestedSimulation, containsPair('stopLoss', 95.0));
    await tester.scrollUntilVisible(find.text('Cuenta simulada · COMPRAR'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Cuenta simulada · COMPRAR'), findsOneWidget);
    expect(find.textContaining('no conecta un broker'), findsOneWidget);
    expect(api.decision, isNull);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('sends explicit closing mode and displays the historical session',
      (tester) async {
    final api = FakeInvestmentApi();
    await tester.pumpWidget(MaterialApp(home: InvestmentScreen(api: api)));
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Solicitar recomendación'), 150,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
        find.text('Análisis fuera de horario · QQQ'), 150,
        scrollable: find.byType(Scrollable).first);
    expect(api.requestedMode, 'AFTER_CLOSE');
    expect(find.text('2026-11-06'), findsOneWidget);
    expect(find.textContaining('No son precios actuales'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('separates model opinion from operative decision',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: InvestmentScreen(
            api: FakeInvestmentApi(status: 'ANALISIS_INFORMATIVO'))));
    await tester.scrollUntilVisible(find.text('Solicitar recomendación'), 150,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    // The explanatory form is taller; reveal the response on a small screen.
    await tester.drag(find.byType(ListView), const Offset(0, -450));
    await tester.pumpAndSettle();
    expect(find.text('Análisis informativo · QQQ'), findsOneWidget);
    expect(find.textContaining('Opinión del modelo (informativa)'),
        findsOneWidget);
    expect(
        find.textContaining('Decisión operativa: ABSTENERSE'), findsOneWidget);
    expect(find.textContaining('No es una cotización instantánea'),
        findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
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
    await tester.scrollUntilVisible(find.text('Solicitar recomendación'), 150,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    // The explanatory form is taller; reveal the response on a small screen.
    await tester.drag(find.byType(ListView), const Offset(0, -450));
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
      await tester.scrollUntilVisible(find.text('Solicitar recomendación'), 150,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Solicitar recomendación'));
      await tester.pumpAndSettle();
      // The explanatory form is taller; reveal the response on a small screen.
      await tester.drag(find.byType(ListView), const Offset(0, -450));
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
    await tester.scrollUntilVisible(find.text('Solicitar recomendación'), 150,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    // The explanatory form is taller; reveal the response on a small screen.
    await tester.drag(find.byType(ListView), const Offset(0, -450));
    await tester.pumpAndSettle();
    expect(api.requests, 0);
    expect(find.textContaining('entero positivo'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, 450));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '1');
    await tester.scrollUntilVisible(find.text('Solicitar recomendación'), 150,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Solicitar recomendación'));
    await tester.pumpAndSettle();
    // The explanatory form is taller; reveal the response on a small screen.
    await tester.drag(find.byType(ListView), const Offset(0, -450));
    await tester.pumpAndSettle();
    expect(find.textContaining('Recomendación vencida'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
