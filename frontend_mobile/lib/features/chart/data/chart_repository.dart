import 'package:dio/dio.dart';
import '../../../core/config/app_config.dart';
import '../domain/chart_data.dart';

class ChartRepository {
  ChartRepository({Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
                baseUrl: AppConfig.apiBaseUrl,
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 10)));
  final Dio _dio;
  Future<ChartSnapshot> load({String? date}) async {
    final response = await _dio.get<Map<String, dynamic>>('/market-data/chart',
        queryParameters: {'symbol': 'QQQ', if (date != null) 'date': date});
    return ChartSnapshot.fromJson(response.data!);
  }

  void dispose() => _dio.close(force: true);
}
