/// Alerta push de activación de hedging (payload `data` versionado del backend).
///
/// El backend envía todos los valores como texto (requisito de FCM). Cualquier
/// campo ausente, con otra versión o con formato inesperado invalida la alerta.
enum HedgingPolicy {
  slow('SLOW', 'Caída lenta'),
  intermediate('INTERMEDIATE', 'Caída intermedia'),
  fast('FAST', 'Caída rápida');

  const HedgingPolicy(this.wire, this.label);
  final String wire;
  final String label;

  static HedgingPolicy? fromWire(Object? value) {
    for (final policy in values) {
      if (policy.wire == value) return policy;
    }
    return null;
  }
}

class HedgingAlert {
  const HedgingAlert({
    required this.correlationId,
    required this.symbol,
    required this.policy,
    required this.price,
    required this.fallPercentPerMinute,
    required this.triggeredAt,
    this.title,
    this.body,
  });

  static const supportedSchemaVersion = '1';
  static const type = 'HEDGING_ACTIVATED';
  static final _symbol = RegExp(r'^[A-Za-z0-9._-]{1,32}$');
  static final _correlation = RegExp(r'^[A-Za-z0-9._-]{1,32}:\d{1,16}$');

  final String correlationId;
  final String symbol;
  final HedgingPolicy policy;
  final double price;
  final double fallPercentPerMinute;
  final DateTime triggeredAt;
  final String? title;
  final String? body;

  /// Ruta del detalle; se construye localmente para no navegar a rutas del payload.
  String get route => routeFor(correlationId);

  static String routeFor(String correlationId) =>
      '/orders/${Uri.encodeComponent(correlationId)}';

  /// Formato `SIMBOLO:eventTimeMs` que genera el motor de stop-loss.
  static bool isValidCorrelationId(String value) =>
      _correlation.hasMatch(value);

  static double? _number(Object? value) {
    final parsed = switch (value) {
      num n => n.toDouble(),
      String s => double.tryParse(s),
      _ => null,
    };
    return parsed != null && parsed.isFinite ? parsed : null;
  }

  static HedgingAlert? tryParse(Map<String, Object?> data,
      {String? title, String? body}) {
    if (data['schemaVersion'] != supportedSchemaVersion) return null;
    if (data['type'] != type) return null;
    final correlationId = data['correlationId'];
    final symbol = data['symbol'];
    if (correlationId is! String || !_correlation.hasMatch(correlationId)) {
      return null;
    }
    if (symbol is! String || !_symbol.hasMatch(symbol)) return null;
    if (!correlationId.startsWith('$symbol:')) return null;
    final policy = HedgingPolicy.fromWire(data['policy']);
    final price = _number(data['price']);
    final fall = _number(data['fallPercentPerMinute']);
    final triggeredAtMs = _number(data['triggeredAtMs']);
    if (policy == null ||
        price == null ||
        price <= 0 ||
        fall == null ||
        fall < 0 ||
        triggeredAtMs == null ||
        triggeredAtMs < 0 ||
        triggeredAtMs != triggeredAtMs.truncateToDouble()) {
      return null;
    }
    return HedgingAlert(
      correlationId: correlationId,
      symbol: symbol,
      policy: policy,
      price: price,
      fallPercentPerMinute: fall,
      triggeredAt: DateTime.fromMillisecondsSinceEpoch(triggeredAtMs.toInt(),
          isUtc: true),
      title: title,
      body: body,
    );
  }

  /// Forma serializable para el payload de la notificación local.
  Map<String, String> toData() => {
        'schemaVersion': supportedSchemaVersion,
        'type': type,
        'correlationId': correlationId,
        'symbol': symbol,
        'policy': policy.wire,
        'price': '$price',
        'fallPercentPerMinute': '$fallPercentPerMinute',
        'triggeredAtMs': '${triggeredAt.millisecondsSinceEpoch}',
      };
}
