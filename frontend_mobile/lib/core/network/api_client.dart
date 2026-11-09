import 'dart:io';
import 'package:dio/dio.dart';
import '../config/app_config.dart';

enum ApiErrorType { network, timeout, server, notFound, sessionInvalid, unknown }

class ApiException implements Exception {
  const ApiException(this.type, this.message, {this.statusCode});
  final ApiErrorType type;
  final String message;
  final int? statusCode;

  @override
  String toString() => 'ApiException($type): $message';
}

class ApiClient {
  ApiClient({Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
              baseUrl: AppConfig.apiBaseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 15),
              headers: {'Accept': 'application/json'},
            ));

  final Dio _dio;

  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    required T Function(dynamic json) fromJson,
  }) async {
    final response = await _request(
      () => _dio.get<dynamic>(path, queryParameters: queryParameters),
    );
    return fromJson(response.data);
  }

  Future<T> post<T>(
    String path, {
    Object? data,
    required T Function(dynamic json) fromJson,
  }) async {
    final response = await _request(
      () => _dio.post<dynamic>(path, data: data),
    );
    return fromJson(response.data);
  }

  Future<T> put<T>(
    String path, {
    Object? data,
    required T Function(dynamic json) fromJson,
  }) async {
    final response = await _request(
      () => _dio.put<dynamic>(path, data: data),
    );
    return fromJson(response.data);
  }

  Future<void> delete(String path) async {
    await _request(() => _dio.delete<dynamic>(path));
  }

  Future<Response<dynamic>> _request(
    Future<Response<dynamic>> Function() call,
  ) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw _mapDioError(e);
    } on SocketException {
      throw const ApiException(
          ApiErrorType.network, 'Sin conexión a internet');
    }
  }

  ApiException _mapDioError(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const ApiException(
            ApiErrorType.timeout, 'Tiempo de espera agotado');
      case DioExceptionType.connectionError:
        return const ApiException(
            ApiErrorType.network, 'No se pudo conectar al servidor');
      case DioExceptionType.badResponse:
        final status = e.response?.statusCode;
        if (status == 401 || status == 403) {
          return ApiException(
              ApiErrorType.sessionInvalid, 'Sesión inválida',
              statusCode: status);
        }
        if (status == 404) {
          return ApiException(
              ApiErrorType.notFound, 'Recurso no encontrado',
              statusCode: status);
        }
        final body = e.response?.data;
        final msg = body is Map ? (body['message'] ?? body['error']) : null;
        return ApiException(
          ApiErrorType.server,
          msg?.toString() ?? 'Error del servidor ($status)',
          statusCode: status,
        );
      default:
        return ApiException(
            ApiErrorType.unknown, e.message ?? 'Error desconocido');
    }
  }
}
