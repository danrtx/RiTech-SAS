import 'dart:io';
import 'package:dio/io.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/features/investment/investment_api.dart';
import 'package:ritech_mobile/features/investment/investment_screen.dart';

const url = String.fromEnvironment('INVESTMENT_E2E_URL');

class RealHttpOverrides extends HttpOverrides {}

void main() {
  testWidgets(
      'Flutter → HTTP → PostgreSQL → model adapter → follow-up → human decision',
      (tester) async {
    final client = Dio(
        BaseOptions(baseUrl: url, receiveTimeout: const Duration(seconds: 10)));
    client.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () => HttpOverrides.runWithHttpOverrides(
            () => HttpClient(), RealHttpOverrides()));
    final api = InvestmentApi(client: client);
    await tester.pumpWidget(MaterialApp(home: InvestmentScreen(api: api)));
    await tester.runAsync(() async {
      await tester.tap(find.text('Solicitar recomendación'));
      await Future<void>.delayed(const Duration(milliseconds: 700));
    });
    await tester.pumpAndSettle();
    expect(find.text('ABSTENERSE'), findsOneWidget);
    await tester
        .ensureVisible(find.text('¿Qué diferencia hay entre NDX y QQQ?'));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(find.text('¿Qué diferencia hay entre NDX y QQQ?'));
      await Future<void>.delayed(const Duration(milliseconds: 700));
    });
    await tester.pumpAndSettle();
    expect(find.textContaining('QQQ es un ETF; NDX es un índice.'),
        findsOneWidget);
    await tester.ensureVisible(find.text('POSPONER'));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(find.text('POSPONER'));
      await Future<void>.delayed(const Duration(milliseconds: 700));
    });
    await tester.pumpAndSettle();
    expect(
        find.textContaining('Decisión registrada: POSPONER'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  }, skip: url.isEmpty);
}
