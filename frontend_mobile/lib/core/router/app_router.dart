import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/notifications/domain/hedging_alert.dart';
import '../../features/notifications/presentation/order_detail_screen.dart';
import '../../features/telemetry/presentation/screens/telemetry_dashboard_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/dashboard',
    routes: [
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
      // Destino del deep link de las alertas push de hedging.
      GoRoute(
        path: '/orders/:correlationId',
        name: 'order-detail',
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
