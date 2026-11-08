/// Registro del dispositivo en el backend para recibir las alertas push.
library;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../../../core/config/app_config.dart';

abstract interface class DeviceRegistrationApi {
  /// Suscribe el token al tópico de alertas del ambiente en el backend.
  Future<void> register(String token);
}

/// Implementación con Dio contra `POST /notifications/devices`.
class HttpDeviceRegistrationApi implements DeviceRegistrationApi {
  HttpDeviceRegistrationApi([Dio? dio])
      : _dio = dio ??
            Dio(BaseOptions(
              baseUrl: AppConfig.apiBaseUrl,
              connectTimeout: const Duration(seconds: 5),
              receiveTimeout: const Duration(seconds: 10),
            ));
  final Dio _dio;

  /// Plataforma que se informa al backend: `web`, `ios` o `android`.
  static String get platform {
    if (kIsWeb) return 'web';
    return defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
  }

  @override
  Future<void> register(String token) async {
    await _dio.post<void>('/notifications/devices',
        data: {'token': token, 'platform': platform});
  }
}
