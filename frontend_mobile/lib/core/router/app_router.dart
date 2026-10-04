import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
