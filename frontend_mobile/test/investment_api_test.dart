import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/features/investment/investment_api.dart';

class RecordingAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  int status = 200;
  String body = '{"id":"saved","decision":"ABSTENERSE"}';
  bool closed = false;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? stream,
      Future<void>? cancelFuture) async {
    requests.add(options);
    return ResponseBody.fromString(body, status, headers: {
      Headers.contentTypeHeader: ['application/json']
    });
  }

  @override
  void close({bool force = false}) => closed = true;
}

void main() {
  late RecordingAdapter adapter;
  late InvestmentApi api;
  setUp(() {
    adapter = RecordingAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'));
    dio.httpClientAdapter = adapter;
    api = InvestmentApi(client: dio);
  });
  tearDown(() => api.close());

  test('sends QQQ quantity, mode and idempotency key without credentials',
      () async {
    expect(await api.recommend(5, 'retry-key'), containsPair('id', 'saved'));
    final request = adapter.requests.single;
    expect(request.method, 'POST');
    expect(request.path, '/api/investment/recommendations');
    expect(request.data, {'symbol': 'QQQ', 'quantity': 5, 'mode': 'INTRADAY'});
    expect(request.headers['Idempotency-Key'], 'retry-key');
    expect(request.headers.containsKey('Authorization'), isFalse);
    await api.recommend(2, 'closing-key', mode: 'AFTER_CLOSE');
    expect(adapter.requests.last.data['mode'], 'AFTER_CLOSE');
  });

  test('detail, question and decision preserve the API contract', () async {
    await api.detail('saved');
    expect(adapter.requests.last.method, 'GET');
    expect(adapter.requests.last.path, '/api/investment/recommendations/saved');
    await api.ask('saved', '¿Qué riesgos hay?', 'question-key');
    expect(adapter.requests.last.path, endsWith('/saved/questions'));
    expect(adapter.requests.last.data, {'question': '¿Qué riesgos hay?'});
    expect(adapter.requests.last.headers['Idempotency-Key'], 'question-key');
    await api.decide('saved', 'POSPONER');
    expect(adapter.requests.last.path, endsWith('/saved/decision'));
    expect(adapter.requests.last.data, {'decision': 'POSPONER'});
    expect(
        adapter.requests.last.headers.containsKey('Idempotency-Key'), isFalse);
  });

  test('rejects remote plaintext before transmitting a request', () async {
    final dio = Dio(BaseOptions(baseUrl: 'http://remote.example'));
    dio.httpClientAdapter = adapter;
    final insecure = InvestmentApi(client: dio);
    addTearDown(insecure.close);
    await expectLater(insecure.recommend(1, 'key'), throwsStateError);
    expect(adapter.requests, isEmpty);
  });

  test('cancel resets token for subsequent requests and close releases client',
      () async {
    await api.detail('one');
    final previous = adapter.requests.single.cancelToken!;
    api.cancel();
    expect(previous.isCancelled, isTrue);
    await api.detail('two');
    expect(adapter.requests.last.cancelToken!.isCancelled, isFalse);
    api.close();
    expect(adapter.closed, isTrue);
  });

  for (final entry in {
    400: 'Error de validación',
    401: 'Acceso denegado',
    403: 'Acceso denegado',
    404: 'No se encontró',
    409: 'Solicitud en proceso',
    429: 'Límite de consultas',
    500: 'Servicio no disponible',
  }.entries) {
    test('HTTP ${entry.key} gives a safe actionable error', () async {
      adapter.status = entry.key;
      adapter.body = '{"secret":"provider-private-payload"}';
      try {
        await api.recommend(1, 'key');
        fail('Expected HTTP failure');
      } on DioException catch (error) {
        expect(investmentError(error), contains(entry.value));
        expect(investmentError(error),
            isNot(contains('provider-private-payload')));
      }
    });
  }
}
