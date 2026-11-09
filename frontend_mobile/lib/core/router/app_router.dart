import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/notifications/domain/hedging_alert.dart';
import '../../features/notifications/presentation/order_detail_screen.dart';
import '../../features/telemetry/presentation/screens/telemetry_dashboard_screen.dart';
import '../../features/settings/presentation/screens/settings_screen.dart';
import '../../features/alerts/presentation/screens/alerts_screen.dart';

import '../../features/investment/investment_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/dashboard',
    routes: [
      GoRoute(
          path: '/investment',
          name: 'investment',
          builder: (context, state) => const InvestmentScreen()),
      GoRoute(
        path: '/dashboard',
        name: 'dashboard',
        builder: (context, state) => const TelemetryDashboardScreen(),
      ),
      GoRoute(
        path: '/hedging',
        name: 'hedging',
        builder: (context, state) => Scaffold(
          appBar: AppBar(title: const Text('Hedging Management')),
          body: const Center(child: Text('Hedging Module Panel')),
        ),
      ),
      GoRoute(
        path: '/alerts',
        name: 'alerts',
        builder: (context, state) => const AlertsScreen(),
      ),
      GoRoute(
        path: '/settings',
        name: 'settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      // Destino del deep link de las alertas push de hedging.
      GoRoute(
        path: '/orders/:correlationId',
        name: 'order-detail',
        // Un id con formato inválido (enlace manipulado) vuelve al tablero en vez de abrir la pantalla.
        redirect: (context, state) => HedgingAlert.isValidCorrelationId(
                state.pathParameters['correlationId'] ?? '')
            ? null
            : '/dashboard',
        builder: (context, state) => OrderDetailScreen(
            correlationId: state.pathParameters['correlationId']!),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Text(
          'Error 404: Ruta no encontrada (${state.uri.toString()})',
          style: const TextStyle(color: Colors.redAccent),
        ),
      ),
    ),
  );
});
