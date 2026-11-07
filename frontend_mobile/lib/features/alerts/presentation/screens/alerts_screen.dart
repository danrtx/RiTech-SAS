import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AlertsScreen extends ConsumerWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Alertas de Volatilidad'),
        backgroundColor: const Color(0xFF161B22),
      ),
      backgroundColor: const Color(0xFF0B111A),
      body: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.notifications_outlined,
              size: 48,
              color: Color(0xFF8D9CB1),
            ),
            SizedBox(height: 16),
            Text(
              'Sin alertas activas',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            SizedBox(height: 8),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                'Las alertas de volatilidad ATR aparecerán aquí cuando el motor detecte variaciones significativas.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF8D9CB1),
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
