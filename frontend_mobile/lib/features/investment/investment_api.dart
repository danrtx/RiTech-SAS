import 'dart:math';
import 'package:dio/dio.dart';
import '../../core/config/app_config.dart';

String requestId() {
  final r = Random.secure();
  final bytes = List<int>.generate(16, (_) => r.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final s = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}';
}

class InvestmentApi {
  InvestmentApi({Dio? client})
      : _dio = client ??
            Dio(BaseOptions(
              baseUrl: AppConfig.apiBaseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 60),
            ));
  final Dio _dio;
  CancelToken _cancel = CancelToken();
  void cancel() {
    _cancel.cancel();
    _cancel = CancelToken();
  }

  void close() {
    cancel();
    _dio.close();
  }

  Future<Map<String, dynamic>> _call(String path,
      {String method = 'POST', Map<String, dynamic>? body, String? key}) async {
    final uri = Uri.parse(_dio.options.baseUrl);
    if (uri.scheme != 'https' &&
        !['localhost', '127.0.0.1', '10.0.2.2'].contains(uri.host)) {
      throw StateError('Se requiere HTTPS para consultar el servicio remoto.');
    }
    final response = await _dio.request<dynamic>('/api/investment/$path',
        data: body,
        cancelToken: _cancel,
        options: Options(method: method, headers: {
          if (key != null) 'Idempotency-Key': key,
        }));
    return response.data == null
        ? {}
        : Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> recommend(int quantity, String key,
          {String mode = 'INTRADAY'}) =>
      _call('recommendations',
          body: {'symbol': 'QQQ', 'quantity': quantity, 'mode': mode},
          key: key);
  Future<Map<String, dynamic>> detail(String id) =>
      _call('recommendations/$id', method: 'GET');
  Future<Map<String, dynamic>> ask(String id, String question, String key) =>
      _call('recommendations/$id/questions',
          body: {'question': question}, key: key);
  Future<Map<String, dynamic>> decide(String id, String decision) =>
      _call('recommendations/$id/decision', body: {'decision': decision});
}

String investmentError(Object error) {
  if (error is DioException) {
    return switch (error.response?.statusCode) {
      400 => 'Error de validación. Revisa los datos ingresados.',
      401 || 403 => 'Acceso denegado por el servidor.',
      404 => 'No se encontró la recomendación.',
      409 =>
        'Solicitud en proceso o decisión ya registrada. Consulta el detalle antes de reintentar.',
      429 => 'Límite de consultas alcanzado. Intenta más tarde.',
      _ => 'Servicio no disponible. Puedes reintentar la misma solicitud.',
    };
  }
  return 'No fue posible completar la consulta. Revisa la conexión segura y los datos.';
}
