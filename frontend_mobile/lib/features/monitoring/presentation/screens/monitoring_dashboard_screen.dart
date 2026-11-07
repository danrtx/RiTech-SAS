import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/websocket_client.dart';
import '../../../telemetry/presentation/providers/telemetry_provider.dart';
import '../../../chart/presentation/providers/chart_provider.dart';
import '../widgets/metric_card.dart';
import '../widgets/profitability_chart.dart';

const _bg = Color(0xFF0B111A);
const _panel = Color(0xFF111923);
const _border = Color(0xFF253141);
const _muted = Color(0xFF8D9CB1);
const _green = Color(0xFF42D3A5);
const _red = Color(0xFFFF6B6B);

class MonitoringDashboardScreen extends ConsumerWidget {
  const MonitoringDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final telemetry = ref.watch(telemetryProvider);
    final chart = ref.watch(chartProvider);
    final snapshot = chart.snapshot;
    final candles = snapshot?.candles ?? [];
    final connected = telemetry.connectionStatus == WebSocketStatus.connected;
    final connecting =
        telemetry.connectionStatus == WebSocketStatus.connecting;

    final wsStatus = connecting
        ? MetricStatus.loading
        : connected
            ? MetricStatus.ready
            : MetricStatus.error;

    final dataStatus = chart.loading
        ? MetricStatus.loading
        : chart.error != null && snapshot == null
            ? MetricStatus.error
            : candles.isEmpty
                ? MetricStatus.empty
                : MetricStatus.ready;

    final pnlSeries = _buildPnlSeries(candles);
    final currentPnl = snapshot?.changePercent;
    final leveragedPnl = currentPnl == null ? null : currentPnl * 2;

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        title: const Text('Monitoreo del Sistema'),
        backgroundColor: const Color(0xFF161B22),
        actions: [
          _connectionBadge(connected, connecting),
          const SizedBox(width: 12),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(chartProvider.notifier).refresh(force: true),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _sectionTitle('ESTADO DE CONEXIÓN'),
            const SizedBox(height: 12),
            _responsiveGrid(context, [
              MetricCard(
                title: 'WebSocket',
                value: connected
                    ? 'Conectado'
                    : connecting
                        ? 'Conectando...'
                        : 'Desconectado',
                subtitle: 'Estado de la conexión en tiempo real',
                status: wsStatus,
                icon: Icons.cable,
                valueColor: connected ? _green : _red,
                errorMessage: 'Sin conexión al servidor WebSocket',
              ),
              MetricCard(
                title: 'Proveedor de datos',
                value: snapshot?.providerConnected == true
                    ? 'Activo'
                    : 'Inactivo',
                subtitle: 'Twelve Data market feed',
                status: dataStatus == MetricStatus.loading
                    ? MetricStatus.loading
                    : snapshot?.providerConnected == true
                        ? MetricStatus.ready
                        : candles.isEmpty
                            ? MetricStatus.empty
                            : MetricStatus.ready,
                icon: Icons.cloud_outlined,
                valueColor:
                    snapshot?.providerConnected == true ? _green : _muted,
              ),
            ]),
            const SizedBox(height: 24),
            _sectionTitle('MÉTRICAS DE MERCADO'),
            const SizedBox(height: 12),
            _responsiveGrid(context, [
              MetricCard(
                title: 'Último precio',
                value: candles.isEmpty
                    ? '—'
                    : '\$${candles.last.close.toStringAsFixed(2)}',
                subtitle: telemetry.activeSymbol,
                status: dataStatus,
                icon: Icons.show_chart,
                errorMessage: chart.error,
              ),
              MetricCard(
                title: 'Velas recibidas',
                value: '${candles.length}',
                subtitle: snapshot?.session == 'historical'
                    ? 'Jornada archivada'
                    : snapshot?.fresh == true
                        ? 'Datos en tiempo real'
                        : 'Datos registrados',
                status: dataStatus,
                icon: Icons.bar_chart,
                errorMessage: chart.error,
              ),
              MetricCard(
                title: 'ATR (1 min)',
                value: _formatAtr(telemetry.lastAtr),
                subtitle: telemetry.lastAtr?['alert'] == true
                    ? 'Volatilidad elevada'
                    : 'Volatilidad normal',
                status: telemetry.lastAtr == null
                    ? connected
                        ? MetricStatus.loading
                        : MetricStatus.empty
                    : telemetry.lastAtr?['status'] == 'ready'
                        ? MetricStatus.ready
                        : MetricStatus.loading,
                icon: Icons.speed,
                valueColor: telemetry.lastAtr?['alert'] == true
                    ? _red
                    : null,
              ),
              MetricCard(
                title: 'Variación jornada',
                value: currentPnl == null
                    ? '—'
                    : '${currentPnl >= 0 ? '+' : ''}${currentPnl.toStringAsFixed(2)}%',
                subtitle: 'Referencia QQQ desde apertura',
                status: dataStatus,
                icon: Icons.trending_up,
                valueColor: (currentPnl ?? 0) >= 0 ? _green : _red,
                errorMessage: chart.error,
              ),
            ]),
            const SizedBox(height: 24),
            _sectionTitle('RENTABILIDAD · MODELO RITECH ×2'),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: _panel,
                border: Border.all(color: _border),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        leveragedPnl == null
                            ? '—'
                            : '${leveragedPnl >= 0 ? '+' : ''}${leveragedPnl.toStringAsFixed(2)}%',
                        style: TextStyle(
                          fontSize: 32,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w600,
                          color: (leveragedPnl ?? 0) >= 0 ? _green : _red,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF302746),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text(
                            '×2',
                            style: TextStyle(
                              color: Color(0xFFBAA5EE),
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  ProfitabilityChart(pnlSeries: pnlSeries),
                  const SizedBox(height: 12),
                  const Text(
                    'Evolución del retorno apalancado ×2 sobre la variación de QQQ desde la apertura registrada.',
                    style: TextStyle(
                      color: _muted,
                      fontSize: 11,
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            _sectionTitle('ESTADO DEL SISTEMA'),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: _panel,
                border: Border.all(color: _border),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  _statusRow(
                    'Sesión de mercado',
                    _sessionLabel(snapshot?.session),
                    Icons.access_time,
                  ),
                  const Divider(color: _border, height: 24),
                  _statusRow(
                    'Histórico',
                    _historyLabel(snapshot?.historyState),
                    Icons.storage,
                  ),
                  const Divider(color: _border, height: 24),
                  _statusRow(
                    'Datos frescos',
                    snapshot?.fresh == true ? 'Sí' : 'No',
                    Icons.update,
                    color: snapshot?.fresh == true ? _green : _muted,
                  ),
                  const Divider(color: _border, height: 24),
                  _statusRow(
                    'Símbolo activo',
                    telemetry.activeSymbol,
                    Icons.label_outline,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  List<double> _buildPnlSeries(List<dynamic> candles) {
    if (candles.isEmpty) return [];
    final openPrice = (candles.first as dynamic).open as double;
    if (openPrice == 0) return [];
    return candles.map((c) {
      final close = (c as dynamic).close as double;
      return ((close - openPrice) / openPrice) * 100 * 2;
    }).toList();
  }

  String _formatAtr(Map<String, Object?>? atr) {
    if (atr == null || atr['status'] != 'ready') return '—';
    final value = atr['atr'] as num?;
    return value?.toStringAsFixed(4) ?? '—';
  }

  String _sessionLabel(String? session) {
    return switch (session) {
      'regular_hours' => 'Horario regular',
      'historical' => 'Jornada archivada',
      'outside_regular_hours' => 'Fuera de horario',
      _ => 'Desconocido',
    };
  }

  String _historyLabel(String? state) {
    return switch (state) {
      'ready' => 'Disponible',
      'loading' => 'Cargando...',
      'unavailable' => 'No disponible',
      _ => 'Desconocido',
    };
  }

  Widget _sectionTitle(String text) {
    return Text(
      text,
      style: const TextStyle(
        color: _muted,
        fontSize: 10,
        letterSpacing: 1.5,
        fontWeight: FontWeight.w600,
      ),
    );
  }

  Widget _connectionBadge(bool connected, bool connecting) {
    final color = connecting
        ? Colors.amber
        : connected
            ? _green
            : _red;
    final label = connecting
        ? 'Conectando...'
        : connected
            ? 'En línea'
            : 'Sin conexión';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(color: color, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _statusRow(
    String label,
    String value,
    IconData icon, {
    Color color = Colors.white,
  }) {
    return Row(
      children: [
        Icon(icon, size: 16, color: _muted),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(color: _muted, fontSize: 12),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontFamily: 'monospace',
          ),
        ),
      ],
    );
  }

  Widget _responsiveGrid(BuildContext context, List<Widget> cards) {
    final width = MediaQuery.sizeOf(context).width;
    final crossCount = width > 900
        ? 4
        : width > 600
            ? 2
            : 1;
    return GridView.count(
      crossAxisCount: crossCount,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: width > 600 ? 2.0 : 2.5,
      children: cards,
    );
  }
}
