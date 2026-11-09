import 'dart:async';
import 'package:flutter/material.dart';
import 'investment_api.dart';

class InvestmentScreen extends StatefulWidget {
  const InvestmentScreen({super.key, this.api});
  final InvestmentApi? api;
  @override
  State<InvestmentScreen> createState() => _InvestmentScreenState();
}

class _InvestmentScreenState extends State<InvestmentScreen> {
  late final InvestmentApi api = widget.api ?? InvestmentApi();
  final quantity = TextEditingController(text: '1');
  final question = TextEditingController();
  final detailId = TextEditingController();
  bool busy = false;
  String? error;
  String? answer;
  String? human;
  Map<String, dynamic>? result;
  String? createKey;
  String? createQuantity;
  String? questionKey;
  String? previousQuestion;
  Timer? clock;
  @override
  void initState() {
    super.initState();
    clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && result != null) setState(() {});
    });
  }

  @override
  void dispose() {
    clock?.cancel();
    api.close();
    for (final controller in [quantity, question, detailId]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> run(Future<void> Function() work) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await work();
    } catch (e) {
      if (mounted) error = investmentError(e);
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    }
  }

  Future<void> create() => run(() async {
        final amount = int.tryParse(quantity.text);
        if (amount == null || amount <= 0 || amount > 1000000) {
          error = 'La cantidad debe ser un entero positivo hasta 1000000.';
          return;
        }
        if (createQuantity != quantity.text) {
          createKey = null;
          createQuantity = quantity.text;
        }
        createKey ??= requestId();
        final value = await api.recommend(amount, createKey!);
        if (!mounted) return;
        result = value;
        detailId.text = value['id'] as String;
        answer = null;
        human = null;
        createKey = null;
      });
  Future<void> ask() => run(() async {
        if (question.text.trim().length < 3) {
          error = 'Escribe una pregunta sobre esta recomendación.';
          return;
        }
        final fingerprint = '${result!['id']}:${question.text}';
        if (previousQuestion != fingerprint) {
          questionKey = null;
          previousQuestion = fingerprint;
        }
        questionKey ??= requestId();
        final value =
            await api.ask(result!['id'] as String, question.text, questionKey!);
        if (!mounted) return;
        answer =
            '${value['answer']}\n${value['requiresNewEvaluation'] == true ? 'Solicita una nueva evaluación para usar datos actuales.' : 'La recomendación original no cambió.'}';
        questionKey = null;
      });
  String time(dynamic value) => value is num
      ? DateTime.fromMillisecondsSinceEpoch(value.toInt()).toLocal().toString()
      : 'No disponible';
  Widget text(String label, dynamic value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: SelectableText('$label: ${value ?? 'No disponible'}'));
  Widget list(String label, dynamic values) =>
      text(label, values is List ? values.join('\n• ') : null);
  @override
  Widget build(BuildContext context) {
    final r = result;
    final expired = r != null &&
        (r['validUntil'] as num? ?? 0) <= DateTime.now().millisecondsSinceEpoch;
    final indicators = r?['indicators'] as Map? ?? {};
    return Scaffold(
      appBar: AppBar(title: const Text('Asistente de inversión general')),
      body: Center(
          child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 850),
              child: ListView(padding: const EdgeInsets.all(20), children: [
                const Text('NASDAQ 100 · Análisis de QQQ',
                    style:
                        TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                const Text(
                    'Apoyo a la decisión, sin garantía de rendimiento. Una recomendación o decisión registrada no solicita ni ejecuta una orden.'),
                const SizedBox(height: 16),
                ...[
                  const Text(
                      'QQQ es un ETF negociable; NDX es el índice de referencia. Sus precios no son intercambiables.'),
                  TextField(
                      controller: quantity,
                      decoration: const InputDecoration(
                          labelText: 'Cantidad a evaluar (no es una orden)'),
                      keyboardType: TextInputType.number,
                      enabled: !busy),
                  FilledButton(
                      onPressed: busy ? null : create,
                      child: const Text('Solicitar recomendación')),
                  TextField(
                      controller: detailId,
                      decoration: const InputDecoration(
                          labelText: 'Identificador de recomendación'),
                      enabled: !busy),
                  OutlinedButton(
                      onPressed: busy
                          ? null
                          : () => run(() async {
                                final value =
                                    await api.detail(detailId.text.trim());
                                if (mounted) {
                                  result = value;
                                  answer = null;
                                  human = null;
                                }
                              }),
                      child: const Text('Consultar detalle')),
                ],
                if (busy)
                  Semantics(
                      label: 'Consultando servicio',
                      child: const LinearProgressIndicator()),
                if (error != null)
                  Semantics(
                      liveRegion: true,
                      child: Text(error!,
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.error))),
                if (r != null)
                  Card(
                      child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                    r['status'] == 'NO_DISPONIBLE'
                                        ? 'Servicio no disponible'
                                        : r['status'] == 'DATOS_INSUFICIENTES'
                                            ? 'Datos insuficientes · ABSTENERSE'
                                            : '${r['decision']}',
                                    style: const TextStyle(
                                        fontSize: 24,
                                        fontWeight: FontWeight.bold)),
                                if (expired)
                                  const Text(
                                      'Recomendación vencida o sin vigencia operativa. Solicita una nueva evaluación.',
                                      style: TextStyle(color: Colors.orange)),
                                text('Instrumento',
                                    'QQQ · Invesco QQQ Trust · ETF · NASDAQ · USD'),
                                text('Justificación', r['justification']),
                                text(
                                    'Horizonte',
                                    r['horizon'] == 'ANALISIS_GENERAL_INTRADIA'
                                        ? 'Análisis general intradía'
                                        : r['horizon']),
                                text('Precio QQQ', indicators['price']),
                                text('Variación de la ventana (%)',
                                    indicators['changePercent']),
                                text('ATR de minutos', indicators['atr']),
                                text(
                                    'Origen del ATR',
                                    indicators['atr'] == null
                                        ? 'No disponible'
                                        : indicators['atrSource'] ==
                                                'provider_ohlc'
                                            ? 'Velas históricas del proveedor'
                                            : 'Cotizaciones en vivo'),
                                text('Fecha de la vela ATR',
                                    time(indicators['atrAt'])),
                                text('Volatilidad', indicators['volatility']),
                                list('Riesgos', r['risks']),
                                text('Escenario favorable', r['favorable']),
                                text('Escenario adverso', r['adverse']),
                                list('Condiciones de invalidación',
                                    r['invalidation']),
                                text('Incertidumbre', r['uncertainty']),
                                list('Limitaciones', r['limitations']),
                                text('Datos de mercado',
                                    time(indicators['quotedAt'])),
                                text('Generada', time(r['generatedAt'])),
                                text('Vigente hasta', time(r['validUntil'])),
                                text(
                                    'Controles de riesgo', r['riskValidation']),
                                text('Fuente de mercado',
                                    indicators['provider']),
                                text('Modelo',
                                    r['modelVersion'] ?? 'No consultado'),
                                text('CorrelationId', r['correlationId']),
                                const Text('Estado: ninguna orden solicitada.'),
                                TextField(
                                    controller: question,
                                    maxLength: 500,
                                    decoration: const InputDecoration(
                                        labelText:
                                            'Pregunta sobre esta recomendación'),
                                    enabled: !busy),
                                Wrap(
                                    spacing: 8,
                                    children: [
                                      '¿Cuáles son los riesgos?',
                                      '¿Qué condiciones la invalidan?',
                                      '¿Qué diferencia hay entre NDX y QQQ?'
                                    ]
                                        .map((q) => ActionChip(
                                            label: Text(q),
                                            onPressed: busy
                                                ? null
                                                : () {
                                                    question.text = q;
                                                    ask();
                                                  }))
                                        .toList()),
                                OutlinedButton(
                                    onPressed: busy ? null : ask,
                                    child: const Text('Consultar al agente')),
                                if (answer != null)
                                  text('Respuesta de seguimiento', answer),
                                const Text(
                                    'Registrar tu decisión (no ejecuta operaciones):'),
                                Wrap(
                                    spacing: 8,
                                    children: [
                                      'SEGUIR',
                                      'DESCARTAR',
                                      'POSPONER'
                                    ]
                                        .map((decision) => OutlinedButton(
                                            onPressed: busy
                                                ? null
                                                : () => run(() async {
                                                      final value =
                                                          await api.decide(
                                                              r['id'] as String,
                                                              decision);
                                                      if (mounted) {
                                                        human =
                                                            'Decisión registrada: ${value['decision']}. Ninguna orden solicitada.';
                                                      }
                                                    }),
                                            child: Text(decision)))
                                        .toList()),
                                if (human != null) Text(human!),
                              ]))),
              ]))),
    );
  }
}
