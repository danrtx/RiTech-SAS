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
  bool afterClose = false;
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
        final selection = '$afterClose:${quantity.text}';
        if (createQuantity != selection) {
          createKey = null;
          createQuantity = selection;
        }
        createKey ??= requestId();
        final value = await api.recommend(amount, createKey!,
            mode: afterClose ? 'AFTER_CLOSE' : 'INTRADAY');
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
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 6),
        SelectableText('${value ?? 'No disponible'}',
            style: const TextStyle(fontSize: 16, height: 1.6)),
      ]));
  Widget list(String label, dynamic values) => text(
      label, values is List ? values.map((v) => '• $v').join('\n\n') : null);
  String number(dynamic value, {int decimals = 2, String suffix = ''}) =>
      value is num && value.isFinite
          ? '${value.toStringAsFixed(decimals).replaceAll('.', ',')}$suffix'
          : 'No disponible';
  Widget metric(String label, String value) => Container(
      width: 165,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 13)),
        const SizedBox(height: 8),
        Text(value,
            style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w600)),
      ]));
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
                  const SizedBox(height: 20),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Análisis fuera del horario de mercado'),
                    subtitle: const Text(
                        'Usa esta opción cuando el mercado esté cerrado. El agente analiza datos reales de la última sesión finalizada, no precios en tiempo real.'),
                    value: afterClose,
                    onChanged: busy
                        ? null
                        : (value) => setState(() => afterClose = value),
                  ),
                  if (afterClose)
                    const Padding(
                        padding: EdgeInsets.only(bottom: 12),
                        child: Text(
                            'Se mostrará la fecha de la sesión analizada. Si el mercado sigue abierto, se usa una sesión anterior. Tendrás hasta 4 horas para hacer preguntas sobre ese mismo informe; no es vigencia para operar.',
                            style: TextStyle(height: 1.5))),
                  const Text(
                      'Introduce el número de participaciones de QQQ. Ejemplo: 5 = cinco participaciones, no dólares ni porcentaje. Se admiten enteros de 1 a 1.000.000.',
                      style: TextStyle(height: 1.5)),
                  const SizedBox(height: 12),
                  TextField(
                      controller: quantity,
                      decoration: const InputDecoration(
                          labelText: 'Cantidad a evaluar (no es una orden)',
                          hintText: 'Ejemplo: 5 participaciones de QQQ',
                          helperText:
                              'Cantidad hipotética; no modifica tu cartera ni reserva dinero.',
                          helperMaxLines: 3),
                      keyboardType: TextInputType.number,
                      enabled: !busy),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: const Text('¿Qué hará el agente con esta cantidad?'),
                    subtitle: const Text(
                        'Analizar QQQ y explicar riesgos y escenarios; no ejecutar órdenes.'),
                    children: [
                      text('Datos que obtiene automáticamente',
                          'El sistema consulta los datos disponibles de QQQ y comprueba su vigencia. Gemini analiza el precio, su variación y el ATR, que indica cuánto se mueve el precio. No necesitas introducir precios ni indicadores. Recibirás una explicación, riesgos y escenarios posibles.'),
                      text('Qué significa la cantidad',
                          'Es el tamaño de una operación hipotética. No informa tu saldo, tus posiciones ni tu tolerancia al riesgo; por sí sola no permite decidir si puedes asumir esa inversión. El análisis de velas cerradas es informativo.'),
                    ],
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                      onPressed: busy ? null : create,
                      child: const Text('Solicitar recomendación')),
                  const SizedBox(height: 20),
                  const Divider(),
                  const Text('Consultar un análisis anterior (opcional)',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  const Text(
                      'Este código se completa al generar una recomendación. Puedes pegar el de otra evaluación para recuperarla. No es necesario para solicitar un análisis nuevo.',
                      style: TextStyle(height: 1.5)),
                  TextField(
                      controller: detailId,
                      decoration: const InputDecoration(
                          labelText: 'Identificador de recomendación',
                          hintText: 'Pega el código de un análisis guardado',
                          helperText:
                              'Consultar detalle recupera el resultado guardado; no actualiza los precios ni genera otro análisis.',
                          helperMaxLines: 3),
                      enabled: !busy),
                  const SizedBox(height: 8),
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
                                    r['status'] == 'ANALISIS_AL_CIERRE'
                                        ? 'Análisis fuera de horario · QQQ'
                                        : r['status'] == 'NO_DISPONIBLE'
                                            ? 'Servicio no disponible'
                                            : r['status'] ==
                                                    'ANALISIS_INFORMATIVO'
                                                ? 'Análisis informativo · QQQ'
                                                : r['status'] ==
                                                        'DATOS_INSUFICIENTES'
                                                    ? 'Datos insuficientes · ABSTENERSE'
                                                    : '${r['decision']}',
                                    style: const TextStyle(
                                        fontSize: 24,
                                        fontWeight: FontWeight.bold)),
                                if (expired)
                                  const Text(
                                      'Recomendación vencida o sin vigencia operativa. Solicita una nueva evaluación.',
                                      style: TextStyle(color: Colors.orange)),
                                const SizedBox(height: 12),
                                if (r['analysisMode'] ==
                                    'CLOSED_BARS_INFORMATIONAL_ONLY') ...[
                                  text('Opinión del modelo (informativa)',
                                      r['modelDecision']),
                                  const Text(
                                      'Velas reales de un minuto ya cerradas. No es una cotización instantánea ni una señal habilitada para operar.',
                                      style: TextStyle(height: 1.5)),
                                  const SizedBox(height: 8),
                                  const Text(
                                      'Decisión operativa: ABSTENERSE hasta disponer de cotización vigente.',
                                      style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                          height: 1.5)),
                                ],
                                if (r['analysisMode'] == 'AFTER_CLOSE') ...[
                                  text('Sesión analizada · Nueva York',
                                      r['sessionDateNY']),
                                  const Text(
                                      'Datos históricos de una sesión finalizada. No son precios actuales ni una señal para operar.',
                                      style: TextStyle(height: 1.5)),
                                  text('Opinión retrospectiva del modelo',
                                      r['modelDecision']),
                                  text(
                                      'Puedes preguntar sobre este informe hasta',
                                      time(r['questionsUntil'])),
                                ],
                                const SizedBox(height: 20),
                                Wrap(spacing: 12, runSpacing: 12, children: [
                                  metric(
                                      'Precio QQQ',
                                      number(indicators['price'],
                                          suffix: ' USD')),
                                  metric(
                                      'Variación',
                                      number(indicators['changePercent'],
                                          suffix: ' %')),
                                  metric('ATR · 1 minuto',
                                      number(indicators['atr'], decimals: 4)),
                                  metric(
                                      'Volatilidad',
                                      indicators['volatility']?.toString() ??
                                          'No disponible'),
                                ]),
                                text('Datos de mercado · hora local',
                                    time(indicators['quotedAt'])),
                                const Divider(height: 32),
                                text('Lectura del agente', r['justification']),
                                list('Riesgos a considerar', r['risks']),
                                text('Escenario favorable', r['favorable']),
                                text('Escenario adverso', r['adverse']),
                                list('Cuándo deja de ser válido',
                                    r['invalidation']),
                                const Divider(height: 32),
                                ExpansionTile(
                                  tilePadding: EdgeInsets.zero,
                                  title: const Text(
                                      'Fuentes, vigencia y detalles'),
                                  subtitle: const Text(
                                      'Modelo, fechas y controles de la evaluación'),
                                  children: [
                                    text('Instrumento',
                                        'QQQ · Invesco QQQ Trust · ETF · NASDAQ · USD'),
                                    text(
                                        'Horizonte',
                                        r['horizon'] ==
                                                'REVISION_SESION_FINALIZADA'
                                            ? 'Revisión de una sesión finalizada'
                                            : r['horizon'] ==
                                                    'ANALISIS_GENERAL_INTRADIA'
                                                ? 'Análisis general intradía'
                                                : r['horizon']),
                                    text('Incertidumbre', r['uncertainty']),
                                    list('Limitaciones', r['limitations']),
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
                                    text('Generada', time(r['generatedAt'])),
                                    text(
                                        r['analysisMode'] == 'AFTER_CLOSE'
                                            ? 'Preguntas disponibles hasta (no vigencia operativa)'
                                            : 'Vigente hasta',
                                        time(r['validUntil'])),
                                    text('Controles de riesgo',
                                        r['riskValidation']),
                                    text('Fuente de mercado',
                                        indicators['provider']),
                                    text('Modelo',
                                        r['modelVersion'] ?? 'No consultado'),
                                    text('Identificador de evaluación',
                                        r['correlationId']),
                                  ],
                                ),
                                const SizedBox(height: 24),
                                const Text('Pregunta al agente',
                                    style: TextStyle(
                                        fontSize: 20,
                                        fontWeight: FontWeight.bold)),
                                const SizedBox(height: 12),
                                const Text(
                                  'Escribe una duda para entender este análisis: sus riesgos, los indicadores o los escenarios. La respuesta explica la evaluación guardada; no consulta precios nuevos ni cambia su conclusión.',
                                  style: TextStyle(fontSize: 16, height: 1.5),
                                ),
                                const SizedBox(height: 12),
                                if (expired)
                                  const Padding(
                                    padding: EdgeInsets.only(bottom: 12),
                                    child: Text(
                                        'Este análisis ya venció. Solicita una nueva recomendación antes de hacer preguntas al agente.',
                                        style: TextStyle(
                                            color: Colors.orange, height: 1.5)),
                                  ),
                                TextField(
                                    controller: question,
                                    maxLength: 500,
                                    minLines: 2,
                                    maxLines: 4,
                                    decoration: const InputDecoration(
                                        border: OutlineInputBorder(),
                                        hintText:
                                            'Ejemplo: ¿Qué significa el ATR que aparece en mi análisis?',
                                        helperText:
                                            'Entre 3 y 500 caracteres. No incluyas claves ni datos de tu cuenta.',
                                        helperMaxLines: 2,
                                        labelText:
                                            'Pregunta sobre esta recomendación'),
                                    enabled: !busy),
                                const SizedBox(height: 16),
                                const Text(
                                    'Preguntas rápidas · pulsa una para enviarla',
                                    style:
                                        TextStyle(fontWeight: FontWeight.w600)),
                                const SizedBox(height: 8),
                                Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
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
                                const SizedBox(height: 12),
                                OutlinedButton(
                                    onPressed: busy ? null : ask,
                                    child: const Text('Consultar al agente')),
                                if (answer != null)
                                  text('Respuesta de seguimiento', answer),
                                const Divider(height: 40),
                                const Text(
                                    'Registra qué harás con este análisis',
                                    style: TextStyle(
                                        fontSize: 20,
                                        fontWeight: FontWeight.bold)),
                                const SizedBox(height: 8),
                                const Text(
                                    'Esta selección solo deja constancia de tu opinión. No compra, vende ni programa operaciones; tampoco cambia la recomendación del agente.',
                                    style:
                                        TextStyle(fontSize: 16, height: 1.5)),
                                const SizedBox(height: 16),
                                Wrap(
                                    spacing: 8,
                                    runSpacing: 12,
                                    children: [
                                      'SEGUIR',
                                      'DESCARTAR',
                                      'POSPONER'
                                    ]
                                        .map((decision) => SizedBox(
                                            width: 220,
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.stretch,
                                              children: [
                                                OutlinedButton(
                                                    onPressed: busy
                                                        ? null
                                                        : () => run(() async {
                                                              final value =
                                                                  await api.decide(
                                                                      r['id']
                                                                          as String,
                                                                      decision);
                                                              if (mounted) {
                                                                human =
                                                                    'Decisión registrada: ${value['decision']}. Ninguna orden solicitada.';
                                                              }
                                                            }),
                                                    child: Text(decision)),
                                                const SizedBox(height: 6),
                                                Text(
                                                    {
                                                      'SEGUIR':
                                                          'Lo tomaré como referencia para mi decisión. No autoriza una orden.',
                                                      'DESCARTAR':
                                                          'No tomaré en cuenta esta recomendación. No elimina el análisis.',
                                                      'POSPONER':
                                                          'Lo revisaré después. No crea un recordatorio ni renueva su vigencia.',
                                                    }[decision]!,
                                                    style: const TextStyle(
                                                        height: 1.5)),
                                              ],
                                            )))
                                        .toList()),
                                const SizedBox(height: 20),
                                const Text('Estado: ninguna orden solicitada.'),
                                if (human != null) Text(human!),
                              ]))),
              ]))),
    );
  }
}
