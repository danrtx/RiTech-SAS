import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/websocket_client.dart';
import '../../../chart/domain/chart_data.dart';
import '../../../chart/presentation/providers/chart_provider.dart';
import '../../../chart/presentation/widgets/market_chart.dart';
import '../providers/telemetry_provider.dart';

const _panel = Color(0xFF111923);
const _border = Color(0xFF253141);

class TelemetryDashboardScreen extends ConsumerStatefulWidget {
  const TelemetryDashboardScreen({super.key});
  @override
  ConsumerState<TelemetryDashboardScreen> createState() => _DashboardState();
}

class _DashboardState extends ConsumerState<TelemetryDashboardScreen> {
  bool _line = false;
  int _interval = 1;
  String _money(double? value) =>
      value == null ? '—' : value.toStringAsFixed(2);
  String _percent(double? value) => value == null
      ? '—'
      : '${value >= 0 ? '+' : ''}${value.toStringAsFixed(2)}%';
  String _date(String? value) {
    if (value == null) return 'Seleccionar fecha';
    final parts = value.split('-');
    return '${parts[2]}/${parts[1]}/${parts[0]}';
  }

  Future<void> _selectDate(ChartSnapshot? snapshot) async {
    final today =
        snapshot == null ? DateTime.now() : DateTime.parse(snapshot.today);
    final selected = await showDatePicker(
        context: context,
        initialDate: snapshot == null ? today : DateTime.parse(snapshot.date),
        firstDate: DateTime(2020),
        lastDate: today,
        helpText: 'CONSULTAR JORNADA',
        confirmText: 'Ver gráfica',
        cancelText: 'Cancelar');
    if (selected != null && mounted) {
      await ref
          .read(chartProvider.notifier)
          .selectDate(selected.toIso8601String().substring(0, 10));
    }
  }

  @override
  Widget build(BuildContext context) {
    final telemetry = ref.watch(telemetryProvider);
    final chart = ref.watch(chartProvider);
    final snapshot = chart.snapshot;
    final data = snapshot?.candles ?? [];
    final connected = telemetry.connectionStatus == WebSocketStatus.connected;
    final tone = (snapshot?.change ?? 0) >= 0 ? chartUp : chartDown;
    return Scaffold(
        backgroundColor: const Color(0xFF0B111A),
        body: SafeArea(
            child: Column(children: [
          Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: _border))),
              child: Row(children: [
                Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                        color: chartUp, borderRadius: BorderRadius.circular(9)),
                    child: const Icon(Icons.multiline_chart,
                        color: Color(0xFF0B111A), size: 23)),
                const SizedBox(width: 10),
                const Text('RiTech',
                    style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.7)),
                if (MediaQuery.sizeOf(context).width > 700) ...[
                  const SizedBox(width: 40),
                  const Text('Mercados',
                      style:
                          TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  const SizedBox(width: 26),
                  const Text('Monitor de inversión',
                      style: TextStyle(fontSize: 13, color: chartMuted)),
                ],
                const Spacer(),
                _badge(connected ? 'Conectado' : 'Sin conexión',
                    connected ? chartUp : chartDown),
              ])),
          Expanded(
              child: SingleChildScrollView(
                  child: Center(
                      child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1500),
            child: Padding(
                padding: EdgeInsets.all(
                    MediaQuery.sizeOf(context).width < 600 ? 16 : 32),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('MERCADOS  /  ESTADOS UNIDOS',
                          style: TextStyle(
                              color: chartMuted,
                              fontSize: 10,
                              letterSpacing: 1.7,
                              fontWeight: FontWeight.w600)),
                      const SizedBox(height: 20),
                      Wrap(
                          alignment: WrapAlignment.spaceBetween,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 36,
                          runSpacing: 18,
                          children: [
                            Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text('Nasdaq 100',
                                      style: TextStyle(
                                          fontSize: 32,
                                          fontWeight: FontWeight.w600,
                                          letterSpacing: -1)),
                                  const SizedBox(height: 7),
                                  Wrap(
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      spacing: 9,
                                      runSpacing: 6,
                                      children: [
                                        Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 7, vertical: 3),
                                            decoration: BoxDecoration(
                                                color: const Color(0xFF26374B),
                                                borderRadius:
                                                    BorderRadius.circular(4)),
                                            child: const Text('QQQ',
                                                style: TextStyle(
                                                    fontSize: 11,
                                                    fontWeight:
                                                        FontWeight.w700))),
                                        const Text(
                                            'ETF de referencia · Twelve Data',
                                            style: TextStyle(
                                                color: chartMuted,
                                                fontSize: 12)),
                                      ]),
                                ]),
                            Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                      data.isEmpty
                                          ? '—'
                                          : '\$${_money(data.last.close)}',
                                      style: const TextStyle(
                                          fontSize: 35,
                                          fontFamily: 'monospace',
                                          fontWeight: FontWeight.w600,
                                          letterSpacing: -1.7)),
                                  const SizedBox(height: 5),
                                  Text(
                                      '${_percent(snapshot?.changePercent)}  ·  Desde la apertura registrada',
                                      style: TextStyle(
                                          color:
                                              data.isEmpty ? chartMuted : tone,
                                          fontSize: 12)),
                                ]),
                          ]),
                      const SizedBox(height: 26),
                      if (chart.error != null) ...[
                        _notice(chart.error!, error: true),
                        const SizedBox(height: 16)
                      ],
                      if (snapshot?.historyState == 'unavailable') ...[
                        _notice(
                            'Twelve Data no pudo completar el histórico. Se muestran los registros disponibles; se reintentará automáticamente.'),
                        const SizedBox(height: 16)
                      ],
                      LayoutBuilder(builder: (context, constraints) {
                        final wide = constraints.maxWidth >= 1080;
                        final main = _chartPanel(chart, connected);
                        final side = _details(snapshot, telemetry);
                        return wide
                            ? Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                    Expanded(child: main),
                                    const SizedBox(width: 20),
                                    SizedBox(width: 270, child: side)
                                  ])
                            : Column(children: [
                                main,
                                const SizedBox(height: 20),
                                side
                              ]);
                      }),
                      const SizedBox(height: 20),
                      Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                              border: Border.all(color: _border),
                              borderRadius: BorderRadius.circular(10)),
                          child: const Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(Icons.info_outline,
                                    size: 17, color: chartMuted),
                                SizedBox(width: 10),
                                Expanded(
                                    child: Text(
                                        'QQQ sigue al Nasdaq 100 y se muestra como referencia; su precio y variación no son el valor exacto del índice NDX. '
                                        'Las velas en formación usan los precios recibidos; las velas históricas se completan con Twelve Data. Los intervalos sin datos quedan vacíos.',
                                        style: TextStyle(
                                            color: chartMuted,
                                            fontSize: 11,
                                            height: 1.6))),
                              ])),
                      const SizedBox(height: 20),
                      const Text('RiTech SAS  /  Inteligencia de mercado',
                          style: TextStyle(
                              color: chartMuted,
                              fontSize: 10,
                              letterSpacing: 0.4)),
                    ])),
          )))),
        ])));
  }

  Widget _chartPanel(ChartState state, bool connected) {
    final snapshot = state.snapshot;
    final data = aggregateCandles(snapshot?.candles ?? [], _interval);
    return Container(
        decoration: BoxDecoration(
            color: _panel,
            border: Border.all(color: _border),
            borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(
              padding: const EdgeInsets.all(18),
              child: Wrap(
                  spacing: 18,
                  runSpacing: 14,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Evolución de la jornada',
                              style: TextStyle(
                                  fontSize: 15, fontWeight: FontWeight.w600)),
                          SizedBox(height: 5),
                          Text('QQQ / USD',
                              style:
                                  TextStyle(color: chartMuted, fontSize: 11)),
                        ]),
                    _toggle(['Velas', 'Línea'], _line ? 1 : 0,
                        (i) => setState(() => _line = i == 1)),
                    _toggle(['1m', '5m', '15m'], [1, 5, 15].indexOf(_interval),
                        (i) => setState(() => _interval = [1, 5, 15][i])),
                  ])),
          const Divider(height: 1, color: _border),
          Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
              child: Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    OutlinedButton.icon(
                        onPressed: () => _selectDate(snapshot),
                        icon:
                            const Icon(Icons.calendar_today_outlined, size: 14),
                        label: Text(_date(snapshot?.date))),
                    TextButton(
                        onPressed: () =>
                            ref.read(chartProvider.notifier).selectDate(null),
                        child: const Text('Última sesión')),
                    IconButton(
                        tooltip: 'Actualizar gráfica',
                        onPressed: () => ref
                            .read(chartProvider.notifier)
                            .refresh(force: true),
                        icon: const Icon(Icons.refresh, size: 18)),
                    if (snapshot != null)
                      _badge(
                          snapshot.session == 'historical'
                              ? 'Histórico'
                              : snapshot.fresh && connected
                                  ? 'Precio reciente'
                                  : 'Datos registrados',
                          snapshot.fresh && connected ? chartUp : chartMuted),
                  ])),
          if (state.loading)
            const SizedBox(
                height: 390,
                child: Center(
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: chartUp)))
          else if (state.error != null && snapshot == null)
            SizedBox(
                height: 390,
                child: Center(
                    child: FilledButton.icon(
                        onPressed: () => ref
                            .read(chartProvider.notifier)
                            .refresh(force: true),
                        icon: const Icon(Icons.refresh),
                        label: const Text('Reintentar conexión'))))
          else
            MarketChart(
                key: ValueKey(snapshot?.date),
                candles: data,
                interval: _interval,
                line: _line),
          Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: _border))),
              child: Wrap(spacing: 16, runSpacing: 5, children: [
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(
                      data.isEmpty
                          ? Icons.hourglass_empty
                          : Icons.cloud_done_outlined,
                      size: 14,
                      color: data.isEmpty ? chartMuted : chartUp),
                  const SizedBox(width: 7),
                  Flexible(
                      child: Text(
                          data.isEmpty
                              ? 'Esperando registros'
                              : 'Jornada guardada',
                          style:
                              const TextStyle(color: chartMuted, fontSize: 11)))
                ]),
                Text('${snapshot?.candles.length ?? 0} velas de 1 min',
                    style: const TextStyle(color: chartMuted, fontSize: 11)),
              ])),
        ]));
  }

  Widget _details(ChartSnapshot? snapshot, TelemetryState telemetry) {
    final candles = snapshot?.candles ?? [];
    final percent = snapshot?.changePercent;
    final actualAtr = snapshot != null && snapshot.date == snapshot.today
        ? telemetry.lastAtr
        : null;
    final readyAtr = actualAtr?['status'] == 'ready';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _card('RESUMEN DE SESIÓN', [
        _detail('Apertura registrada',
            _money(candles.isEmpty ? null : candles.first.open)),
        _detail('Máximo', _money(snapshot?.high), color: chartUp),
        _detail('Mínimo', _money(snapshot?.low), color: chartDown),
        _detail('Último precio',
            _money(candles.isEmpty ? null : candles.last.close)),
        _detail('Variación', _percent(percent),
            color: (percent ?? 0) >= 0 ? chartUp : chartDown),
        const SizedBox(height: 6),
        const Divider(color: _border),
        const SizedBox(height: 6),
        Row(children: [
          const Icon(Icons.schedule, size: 14, color: chartMuted),
          const SizedBox(width: 7),
          Expanded(
              child: Text(
                  candles.isEmpty
                      ? 'Sin registros'
                      : 'Última vela: ${candles.last.timeLabel} ET',
                  style: const TextStyle(color: chartMuted, fontSize: 11)))
        ]),
        const SizedBox(height: 10),
        Text(
            snapshot?.session == 'historical'
                ? 'Jornada archivada · ${_date(snapshot?.date)}'
                : snapshot?.session == 'outside_regular_hours'
                    ? 'Fuera del horario regular habitual'
                    : 'Horario regular · 09:30–16:00 ET',
            style: const TextStyle(fontSize: 11, color: chartMuted)),
      ]),
      const SizedBox(height: 16),
      _card('ESCENARIO RITECH', [
        Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Text(_percent(percent == null ? null : percent * 2),
              style: TextStyle(
                  fontSize: 29,
                  fontFamily: 'monospace',
                  color: (percent ?? 0) >= 0 ? chartUp : chartDown)),
          const Spacer(),
          Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                  color: const Color(0xFF302746),
                  borderRadius: BorderRadius.circular(8)),
              child: const Text('×2',
                  style: TextStyle(
                      color: Color(0xFFBAA5EE), fontWeight: FontWeight.bold))),
        ]),
        const SizedBox(height: 12),
        const Text(
            'Modelo del enunciado: dos veces la variación observada en QQQ. Referencia desde la apertura registrada.',
            style: TextStyle(color: chartMuted, fontSize: 11, height: 1.6)),
      ]),
      const SizedBox(height: 16),
      _card('VOLATILIDAD · ATR 1 MIN', [
        Text(
            readyAtr
                ? (actualAtr?['atr'] as num?)?.toStringAsFixed(4) ?? '—'
                : '—',
            style: const TextStyle(fontSize: 25, fontFamily: 'monospace')),
        const SizedBox(height: 10),
        Text(
            readyAtr
                ? 'Línea base: ${(actualAtr?['baseline'] as num?)?.toStringAsFixed(4) ?? '—'}'
                : snapshot?.session == 'historical'
                    ? 'El ATR mostrado corresponde a la sesión en vivo.'
                    : 'Esperando suficientes velas de ticks válidos.',
            style:
                const TextStyle(color: chartMuted, fontSize: 11, height: 1.6)),
        if (actualAtr?['alert'] == true) ...[
          const SizedBox(height: 8),
          const Text('Aumento de volatilidad',
              style: TextStyle(color: chartDown, fontSize: 12))
        ],
      ]),
      if (snapshot != null && snapshot.dates.isNotEmpty) ...[
        const SizedBox(height: 16),
        _card('JORNADAS GUARDADAS', [
          for (final date in snapshot.dates.take(5))
            Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: TextButton(
                    style: TextButton.styleFrom(
                        foregroundColor:
                            date == snapshot.date ? chartUp : chartMuted,
                        padding: const EdgeInsets.symmetric(horizontal: 4)),
                    onPressed: () =>
                        ref.read(chartProvider.notifier).selectDate(date),
                    child: Row(children: [
                      const Icon(Icons.history, size: 15),
                      const SizedBox(width: 10),
                      Text(_date(date)),
                      const Spacer(),
                      const Icon(Icons.chevron_right, size: 16)
                    ]))),
        ]),
      ],
    ]);
  }

  Widget _detail(String label, String value, {Color color = Colors.white}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 17),
          child: Row(children: [
            Expanded(
                child: Text(label,
                    style: const TextStyle(color: chartMuted, fontSize: 12))),
            Text(value,
                style: TextStyle(
                    color: color, fontFamily: 'monospace', fontSize: 13))
          ]));
  Widget _card(String title, List<Widget> children) => Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
          color: _panel,
          border: Border.all(color: _border),
          borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title,
            style: const TextStyle(
                fontSize: 10,
                color: chartMuted,
                letterSpacing: 1.2,
                fontWeight: FontWeight.w600)),
        const SizedBox(height: 20),
        ...children
      ]));
  Widget _badge(String label, Color color) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(5)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
            width: 5,
            height: 5,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 7),
        Text(label,
            style: TextStyle(
                color: color, fontSize: 10, fontWeight: FontWeight.w500))
      ]));
  Widget _toggle(
          List<String> values, int selected, ValueChanged<int> onSelect) =>
      Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
              color: const Color(0xFF0B111A),
              borderRadius: BorderRadius.circular(6)),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            for (var i = 0; i < values.length; i++)
              Semantics(
                  selected: selected == i,
                  button: true,
                  child: InkWell(
                      borderRadius: BorderRadius.circular(4),
                      onTap: () => onSelect(i),
                      child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 11, vertical: 7),
                          decoration: BoxDecoration(
                              color: selected == i
                                  ? const Color(0xFF293748)
                                  : Colors.transparent,
                              borderRadius: BorderRadius.circular(4)),
                          child: Text(values[i],
                              style: TextStyle(
                                  fontSize: 12,
                                  color: selected == i
                                      ? Colors.white
                                      : chartMuted)))))
          ]));
  Widget _notice(String text, {bool error = false}) => Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: (error ? chartDown : Colors.amber).withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(8)),
      child: Text(text,
          style: TextStyle(
              color: error ? chartDown : Colors.amber.shade200,
              fontSize: 12,
              height: 1.5)));
}
