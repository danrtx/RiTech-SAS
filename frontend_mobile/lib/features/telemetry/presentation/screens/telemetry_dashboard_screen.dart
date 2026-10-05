import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/websocket_client.dart';
import '../providers/telemetry_provider.dart';

class TelemetryDashboardScreen extends ConsumerWidget {
  const TelemetryDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final telemetryState = ref.watch(telemetryProvider);
    final telemetryNotifier = ref.read(telemetryProvider.notifier);

    return Scaffold(
      backgroundColor: const Color(0xFF0D1117), // Sleek Dark Theme
      appBar: AppBar(
        title: const Text(
          'NASDAQ 100 Hedging Telemetry',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        backgroundColor: const Color(0xFF161B22),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16.0),
            child: _buildStatusBadge(telemetryState.connectionStatus),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Symbol Switcher
            Row(
              children: ['NDX', 'QQQ', 'AAPL', 'NVDA'].map((symbol) {
                final isSelected = telemetryState.activeSymbol == symbol;
                return Padding(
                  padding: const EdgeInsets.only(right: 8.0),
                  child: FilterChip(
                    label: Text(symbol),
                    selected: isSelected,
                    selectedColor: const Color(0xFF238636),
                    backgroundColor: const Color(0xFF21262D),
                    labelStyle: TextStyle(
                      color: isSelected ? Colors.white : Colors.grey,
                      fontWeight: FontWeight.bold,
                    ),
                    onSelected: (_) => telemetryNotifier.switchSymbol(symbol),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 24),

            // Live Telemetry Card
            Card(
              color: const Color(0xFF161B22),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: const BorderSide(color: Color(0xFF30363D)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Símbolo Activo: ${telemetryState.activeSymbol}',
                      style: const TextStyle(
                        color: Colors.grey,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      telemetryState.lastTick?['price'] != null
                          ? '\$${telemetryState.lastTick!['price']}'
                          : 'Esperando datos...',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Volumen: ${telemetryState.lastTick?['volume'] ?? 'N/A'}',
                          style: const TextStyle(color: Colors.grey),
                        ),
                        Text(
                          'Timestamp: ${telemetryState.lastTick?['timestamp'] ?? '-'}',
                          style:
                              const TextStyle(color: Colors.grey, fontSize: 12),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'ATR 1 min: ${telemetryState.lastAtr?['atr'] ?? 'Esperando velas cerradas'}',
                      style: const TextStyle(color: Colors.white),
                    ),
                    Text(
                      'Línea base: ${telemetryState.lastAtr?['baseline'] ?? '-'} · '
                      'Estado: ${telemetryState.lastAtr?['status'] ?? 'sin datos'}',
                      style: const TextStyle(color: Colors.grey),
                    ),
                    if (telemetryState.lastAtr?['alert'] == true)
                      const Text('Aumento de volatilidad',
                          style: TextStyle(color: Colors.orange)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusBadge(WebSocketStatus status) {
    Color color;
    String label;

    switch (status) {
      case WebSocketStatus.connected:
        color = Colors.green;
        label = 'LIVE';
        break;
      case WebSocketStatus.connecting:
        color = Colors.orange;
        label = 'CONNECTING';
        break;
      case WebSocketStatus.disconnected:
        color = Colors.red;
        label = 'OFFLINE';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
                color: color, fontWeight: FontWeight.bold, fontSize: 11),
          ),
        ],
      ),
    );
  }
}
