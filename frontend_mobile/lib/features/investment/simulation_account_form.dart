import 'package:flutter/material.dart';

class SimulationAccountForm extends StatefulWidget {
  const SimulationAccountForm({super.key, required this.enabled});
  final bool enabled;
  @override
  State<SimulationAccountForm> createState() => SimulationAccountFormState();
}

class SimulationAccountFormState extends State<SimulationAccountForm> {
  final form = GlobalKey<FormState>();
  static const fields = <String, (String, String, String)>{
    'cash': (
      'Saldo disponible ficticio (USD)',
      '10000',
      'Dinero libre para comprar; no incluyas fondos reservados.'
    ),
    'quantity': (
      'Participaciones QQQ disponibles',
      '0',
      'Enteros disponibles para vender, sin participaciones comprometidas.'
    ),
    'averageEntry': (
      'Precio promedio de compra (USD)',
      '0',
      'Costo por participación; usa 0 si no tienes QQQ.'
    ),
    'otherExposure': (
      'Otras inversiones (USD)',
      '0',
      'Valor de posiciones distintas de QQQ y compromisos existentes.'
    ),
    'maxExposure': (
      'Límite total invertido (USD)',
      '5000',
      'Máximo permitido entre QQQ y otras inversiones.'
    ),
    'maxInstrumentExposure': (
      'Límite invertido en QQQ (USD)',
      '3000',
      'No puede superar el límite total.'
    ),
    'maxTradeRisk': (
      'Pérdida máxima por operación (USD)',
      '100',
      'Presupuesto de riesgo hasta el stop-loss; no garantiza esa pérdida máxima.'
    ),
    'stopLoss': (
      'Precio de stop-loss simulado (USD)',
      '',
      'Debe ser positivo y menor al precio QQQ usado en el análisis. No coloca una orden.'
    ),
    'maxAtrPercent': (
      'ATR máximo permitido (%)',
      '2',
      'Bloquea el escenario si ATR / precio × 100 supera este porcentaje.'
    ),
  };
  late final controllers = {
    for (final field in fields.entries)
      field.key: TextEditingController(text: field.value.$2),
  };

  Map<String, dynamic>? read() {
    if (!form.currentState!.validate()) return null;
    double number(String key) =>
        double.parse(controllers[key]!.text.trim().replaceAll(',', '.'));
    return {
      'kind': 'SIMULATED',
      for (final key in fields.keys
          .where((key) => !['quantity', 'averageEntry'].contains(key)))
        key: number(key),
      'position': {
        'quantity': number('quantity').toInt(),
        'averageEntry': number('averageEntry')
      },
    };
  }

  @override
  void dispose() {
    for (final controller in controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Form(
      key: form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Cuenta simulada · valores ficticios',
              style: TextStyle(fontWeight: FontWeight.bold)),
          const Text(
              'Los valores iniciales son ejemplos editables, no límites recomendados. Se enviará este escenario a Gemini y se guardará con el análisis. No introduzcas datos privados reales. Evaluación intradía, sin cobertura obligatoria en este ejercicio; no conecta una cuenta ni compra o vende.'),
          for (final field in fields.entries)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: TextFormField(
                  key: ValueKey('simulation-${field.key}'),
                  controller: controllers[field.key],
                  enabled: widget.enabled,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                      labelText: field.value.$1,
                      helperText: field.value.$3,
                      helperMaxLines: 3),
                  validator: (value) {
                    final n = double.tryParse(
                        (value ?? '').trim().replaceAll(',', '.'));
                    if (n == null || !n.isFinite || n < 0 || n > 1e12)
                      return 'Introduce un número válido, sin separador de miles.';
                    if (field.key == 'quantity' &&
                        (n != n.truncateToDouble() || n > 10000000))
                      return 'Introduce participaciones enteras.';
                    if (field.key == 'averageEntry' &&
                        n == 0 &&
                        (double.tryParse(controllers['quantity']!.text) ?? 0) >
                            0) return 'Indica un costo promedio positivo.';
                    if (['stopLoss', 'maxAtrPercent'].contains(field.key) &&
                        n <= 0) return 'Debe ser mayor que cero.';
                    if (field.key == 'stopLoss' && n > 1e8)
                      return 'Precio fuera del rango permitido.';
                    if (field.key == 'maxAtrPercent' && n > 100)
                      return 'El máximo es 100 %.';
                    if (field.key == 'maxInstrumentExposure' &&
                        n >
                            (double.tryParse(controllers['maxExposure']!
                                    .text
                                    .replaceAll(',', '.')) ??
                                0)) return 'No puede superar el límite total.';
                    return null;
                  },
                )),
        ],
      ));
}
