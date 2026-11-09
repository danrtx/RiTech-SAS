import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ritech_mobile/core/router/app_router.dart';

void main() {
  group('AppRouter', () {
    late GoRouter router;

    setUp(() {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      router = container.read(appRouterProvider);
    });

    test('ruta inicial es /dashboard', () {
      expect(
        router.routeInformationProvider.value.uri.path,
        '/dashboard',
      );
    });

    test('contiene las rutas base', () {
      final config = router.configuration;
      final paths = <String>[];
      for (final route in config.routes) {
        if (route is GoRoute) {
          paths.add(route.path);
        }
      }
      expect(paths, contains('/dashboard'));
      expect(paths, contains('/hedging'));
      expect(paths, contains('/alerts'));
      expect(paths, contains('/settings'));
    });

    testWidgets('navega a /dashboard y muestra contenido', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('RiTech'), findsOneWidget);
    });

    testWidgets('navega a /settings y muestra pantalla', (tester) async {
      router.go('/settings');
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Configuración'), findsOneWidget);
    });

    testWidgets('navega a /alerts y muestra pantalla', (tester) async {
      router.go('/alerts');
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Alertas de Volatilidad'), findsOneWidget);
    });

    testWidgets('ruta desconocida muestra error 404', (tester) async {
      router.go('/ruta-inexistente');
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Error 404'), findsOneWidget);
    });
  });
}
