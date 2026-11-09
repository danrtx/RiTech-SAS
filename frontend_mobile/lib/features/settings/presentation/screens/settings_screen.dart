import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/config/app_config.dart';
import '../../../market_data/presentation/providers/market_data_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final market = ref.watch(marketDataProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Configuración'),
        backgroundColor: const Color(0xFF161B22),
      ),
      backgroundColor: const Color(0xFF0B111A),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          FilledButton(
            onPressed: market.loading ? null : () => ref.read(marketDataProvider.notifier).refresh(force: true),
            child: Text(market.loading ? 'Comprobando conexión…' : 'Comprobar conexión'),
          ),
          if (market.error != null) Text(market.error!),
          if (market.health != null) Text('Servicios: ${market.health!.isOk ? "disponibles" : "no disponibles"}'),
          _section('Conexión', [
            _tile(
              icon: Icons.dns_outlined,
              title: 'API Backend',
              subtitle: AppConfig.apiBaseUrl,
            ),
            _tile(
              icon: Icons.cable,
              title: 'WebSocket',
              subtitle: AppConfig.wsBaseUrl,
            ),
          ]),
          const SizedBox(height: 24),
          _section('Mercado', [
            _tile(
              icon: Icons.show_chart,
              title: 'Símbolo activo',
              subtitle: AppConfig.marketSymbol,
            ),
          ]),
          const SizedBox(height: 24),
          _section('Aplicación', [
            _tile(
              icon: Icons.info_outline,
              title: 'Versión',
              subtitle: '1.0.0',
            ),
          ]),
        ],
      ),
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title.toUpperCase(),
          style: const TextStyle(
            color: Color(0xFF8D9CB1),
            fontSize: 11,
            letterSpacing: 1.5,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFF111923),
            border: Border.all(color: const Color(0xFF253141)),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(children: children),
        ),
      ],
    );
  }

  Widget _tile({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return ListTile(
      leading: Icon(icon, color: const Color(0xFF42D3A5), size: 22),
      title: Text(title, style: const TextStyle(fontSize: 14)),
      subtitle: Text(
        subtitle,
        style: const TextStyle(
          color: Color(0xFF8D9CB1),
          fontSize: 12,
          fontFamily: 'monospace',
        ),
      ),
    );
  }
}
