/// Modelo de la alerta push de hedging y validación del mensaje que llega de FCM.
///
/// El backend envía todos los valores como texto (requisito de FCM). Cualquier
/// campo ausente, con otra versión o con formato inesperado invalida la alerta.
/// El contrato del backend está en `backend/src/modules/notifications/hedging-push.payload.ts`.
library;

/// Política del stop-loss según la velocidad de caída del precio.
enum HedgingPolicy {
  slow('SLOW', 'Caída lenta'),
  intermediate('INTERMEDIATE', 'Caída intermedia'),
  fast('FAST', 'Caída rápida');

  const HedgingPolicy(this.wire, this.label);

  /// Valor tal como viaja en el mensaje (`SLOW`, `INTERMEDIATE`, `FAST`).
  final String wire;

  /// Texto en español para mostrar en pantalla.
  final String label;

  /// Convierte el valor del mensaje en la política; `null` si no es uno conocido.
  static HedgingPolicy? fromWire(Object? value) {
    for (final policy in values) {
      if (policy.wire == value) return policy;
    }
    return null;
  }
}

/// Alerta ya validada: una solicitud de stop-loss que el backend notificó.
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

  /// Única versión del contrato que esta app entiende.
  static const supportedSchemaVersion = '1';
  static const type = 'HEDGING_ACTIVATED';
  // Mismos formatos que valida el backend para símbolo y correlación.
  static final _symbol = RegExp(r'^[A-Za-z0-9._-]{1,32}$');
  static final _correlation = RegExp(r'^[A-Za-z0-9._-]{1,32}:\d{1,16}$');

  /// Identificador del episodio y de la orden: `SIMBOLO:eventTimeMs`.
  final String correlationId;
  final String symbol;
  final HedgingPolicy policy;

  /// Precio de activación en USD.
  final double price;

  /// Velocidad de caída en % por minuto.
  final double fallPercentPerMinute;

  /// Momento de la activación (UTC).
  final DateTime triggeredAt;

  /// Título y cuerpo de la notificación, si FCM los entregó.
  final String? title;
  final String? body;

  /// Ruta del detalle; se construye localmente para no navegar a rutas del payload.
  String get route => routeFor(correlationId);

  /// Ruta del detalle para un correlationId; se codifica porque contiene `:`.
  static String routeFor(String correlationId) =>
      '/orders/${Uri.encodeComponent(correlationId)}';

  /// Formato `SIMBOLO:eventTimeMs` que genera el motor de stop-loss.
  static bool isValidCorrelationId(String value) =>
      _correlation.hasMatch(value);

  /// Acepta número o texto numérico; descarta NaN e infinitos.
  static double? _number(Object? value) {
    final parsed = switch (value) {
      num n => n.toDouble(),
      String s => double.tryParse(s),
      _ => null,
    };
    return parsed != null && parsed.isFinite ? parsed : null;
  }

  /// Valida el mensaje de FCM y construye la alerta; devuelve `null` si algo no cuadra.
  ///
  /// Nunca lanza: un mensaje malformado o de otra versión simplemente se ignora.
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
    // La correlación debe pertenecer al mismo símbolo que dice el mensaje.
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
        // Un timestamp en milisegundos debe ser entero.
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
