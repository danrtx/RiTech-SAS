import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../application/push_notifications_controller.dart';

/// Detalle de la orden solicitada por una activación de hedging.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.correlationId});
  final String correlationId;

  String _time(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alert = ref.watch(
        pushNotificationsProvider.select((state) => state.alerts[correlationId]));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Detalle de la orden'),
        leading: IconButton(
          tooltip: 'Volver al tablero',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
      ),
      body: SafeArea(
        child: alert == null
            ? _Missing(correlationId: correlationId)
            : ListView(padding: const EdgeInsets.all(16), children: [
                Text('Hedging activado en ${alert.symbol}',
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Text(
                    'Solicitud de stop-loss. No confirma ejecución ni llenado en el bróker.',
                    style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 16),
                _Row('Política', alert.policy.label),
                _Row('Precio de activación', '${alert.price.toStringAsFixed(2)} USD'),
                _Row('Velocidad de caída',
                    '${alert.fallPercentPerMinute.toStringAsFixed(2)} %/min'),
                _Row('Activado', _time(alert.triggeredAt)),
                _Row('Correlación', alert.correlationId),
              ]),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(label)),
          const SizedBox(width: 12),
          Expanded(child: SelectableText(value, textAlign: TextAlign.end)),
        ]),
      );
}

class _Missing extends StatelessWidget {
  const _Missing({required this.correlationId});
  final String correlationId;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.notifications_off_outlined, size: 40),
            const SizedBox(height: 12),
            const Text('No hay datos de esta alerta en la sesión actual.',
                textAlign: TextAlign.center),
            const SizedBox(height: 4),
            SelectableText(correlationId,
                style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 16),
            FilledButton(
                onPressed: () => context.go('/dashboard'),
                child: const Text('Ir al tablero')),
          ]),
        ),
      );
}
