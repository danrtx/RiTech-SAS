import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ritech_mobile/core/router/app_router.dart';
import 'package:ritech_mobile/features/monitoring/presentation/widgets/metric_card.dart';

void main() {
  group('MetricCard', () {
    Widget wrap(Widget child) => MaterialApp(
          theme: ThemeData.dark(),
          home: Scaffold(body: child),
        );

    test('MetricStatus tiene los cuatro estados', () {
      expect(MetricStatus.values.length, 4);
      expect(MetricStatus.values, contains(MetricStatus.loading));
      expect(MetricStatus.values, contains(MetricStatus.empty));
      expect(MetricStatus.values, contains(MetricStatus.ready));
      expect(MetricStatus.values, contains(MetricStatus.error));
    });

    testWidgets('muestra indicador de carga en estado loading', (tester) async {
      await tester.pumpWidget(wrap(const MetricCard(
        title: 'Test',
        value: '100',
        status: MetricStatus.loading,
      )));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Cargando...'), findsOneWidget);
    });

    testWidgets('muestra mensaje vacío en estado empty', (tester) async {
      await tester.pumpWidget(wrap(const MetricCard(
        title: 'Test',
        value: '100',
        status: MetricStatus.empty,
      )));
      expect(find.text('Sin datos disponibles'), findsOneWidget);
    });

    testWidgets('muestra valor en estado ready', (tester) async {
      await tester.pumpWidget(wrap(const MetricCard(
        title: 'Precio',
        value: '\$485.50',
        subtitle: 'QQQ',
        status: MetricStatus.ready,
      )));
      expect(find.text('\$485.50'), findsOneWidget);
      expect(find.text('QQQ'), findsOneWidget);
    });

    testWidgets('muestra error en estado error', (tester) async {
      await tester.pumpWidget(wrap(const MetricCard(
        title: 'Test',
        value: '—',
        status: MetricStatus.error,
        errorMessage: 'Sin conexión al servidor',
      )));
      expect(find.text('Sin conexión al servidor'), findsOneWidget);
    });

    testWidgets('muestra error genérico sin errorMessage', (tester) async {
      await tester.pumpWidget(wrap(const MetricCard(
        title: 'Test',
        value: '—',
        status: MetricStatus.error,
      )));
      expect(find.text('Error al obtener datos'), findsOneWidget);
    });
  });

  group('Ruta /monitoring', () {
    test('el router contiene la ruta /monitoring', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final router = container.read(appRouterProvider);
      final config = router.configuration;
      final paths = <String>[];
      for (final route in config.routes) {
        if (route is GoRoute) {
          paths.add(route.path);
        }
      }
      expect(paths, contains('/monitoring'));
    });

    testWidgets('navega a /monitoring y muestra pantalla', (tester) async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final router = container.read(appRouterProvider);
      router.go('/monitoring');
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Monitoreo del Sistema'), findsOneWidget);
    });
  });
}
