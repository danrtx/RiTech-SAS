import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ritech_mobile/core/network/websocket_client.dart';
import 'package:ritech_mobile/features/chart/data/chart_repository.dart';
import 'package:ritech_mobile/features/chart/domain/chart_data.dart';
import 'package:ritech_mobile/features/chart/presentation/providers/chart_provider.dart';
import 'package:ritech_mobile/features/chart/presentation/widgets/market_chart.dart';
import 'package:ritech_mobile/features/telemetry/presentation/providers/telemetry_provider.dart';
import 'package:ritech_mobile/features/telemetry/presentation/screens/telemetry_dashboard_screen.dart';
import 'socket_transport_test.dart' show FakeTransport;

final start = DateTime.parse('2026-10-07T14:00:00Z').millisecondsSinceEpoch;
Map<String, dynamic> candleJson(
        {int minute = 0,
        double close = 101,
        int version = 1,
        String date = '2026-10-07'}) =>
    {
      'symbol': 'QQQ',
      'startTimeMs': start + minute * 60000,
      'timeLabel': '10:${minute.toString().padLeft(2, '0')}',
      'date': date,
      'open': 100,
      'high': 105,
      'low': 98,
      'close': close,
      'volume': 1200,
      'source': 'stream',
      'updatedAtMs': version,
    };
ChartSnapshot snapshot(
        {String date = '2026-10-07', List<ChartCandle>? candles}) =>
    ChartSnapshot(
        date: date,
        today: '2026-10-07',
        dates: const ['2026-10-07', '2026-10-06'],
        candles: candles ??
            List.generate(
                30, (i) => ChartCandle.fromJson(candleJson(minute: i))),
        session: date == '2026-10-07' ? 'regular_hours' : 'historical',
        historyState: 'ready',
        fresh: false,
        providerConnected: true);

class FakeRepository extends ChartRepository {
  Future<ChartSnapshot> Function(String?)? response;
  @override
  Future<ChartSnapshot> load({String? date}) async => response == null
      ? snapshot(date: date ?? '2026-10-07')
      : await response!(date);
}

void main() {
  test('aggregates OHLC into 5-minute candles without inventing missing volume',
      () {
    final candles = [
      ChartCandle.fromJson(candleJson(close: 102)),
      ChartCandle.fromJson(
          {...candleJson(minute: 1, close: 99), 'volume': null}),
      ChartCandle.fromJson(candleJson(minute: 5, close: 103)),
    ];
    final aggregate = aggregateCandles(candles, 5);
    expect(aggregate, hasLength(2));
    expect(aggregate[0].open, 100);
    expect(aggregate[0].close, 99);
    expect(aggregate[0].high, 105);
    expect(aggregate[0].low, 98);
    expect(aggregate[0].volume, isNull);
    expect(aggregate[1].timeLabel, '10:05');
  });
  test('older snapshots cannot replace newer candles or mix sessions', () {
    final latest = ChartCandle.fromJson(candleJson(close: 103, version: 3));
    final stale = ChartCandle.fromJson(candleJson(close: 99, version: 1));
    final anotherDay = ChartCandle.fromJson(candleJson(date: '2026-10-06'));
    final merged = mergeCandles([latest], [stale, anotherDay], '2026-10-07');
    expect(merged.single.close, 103);
  });
  test(
      'a websocket candle arriving during HTTP loading survives the response and disconnect',
      () async {
    final repo = FakeRepository();
    final pending = Completer<ChartSnapshot>();
    repo.response = (_) => pending.future;
    final transport = FakeTransport();
    final client = TelemetryWebSocketClient(transport: transport)
      ..subscribeSymbol('QQQ');
    final notifier = ChartNotifier(repo, client, polling: false);
    transport.receive('chart_candle', candleJson(close: 104, version: 4));
    await Future<void>.delayed(Duration.zero);
    pending.complete(snapshot(candles: [ChartCandle.fromJson(candleJson())]));
    await Future<void>.delayed(Duration.zero);
    expect(notifier.state.snapshot!.candles.single.close, 104);
    transport.receive('disconnect');
    await Future<void>.delayed(Duration.zero);
    expect(notifier.state.snapshot!.candles.single.close, 104);
    notifier.dispose();
    client.dispose();
    repo.dispose();
  });
  test(
      'late date response cannot overwrite a selected historical session; live events stay separate',
      () async {
    final repo = FakeRepository();
    final pending = Completer<ChartSnapshot>();
    repo.response = (date) => date == null
        ? pending.future
        : Future.value(snapshot(date: date, candles: []));
    final transport = FakeTransport();
    final client = TelemetryWebSocketClient(transport: transport)
      ..subscribeSymbol('QQQ');
    final notifier = ChartNotifier(repo, client, polling: false);
    await notifier.selectDate('2026-10-06');
    pending.complete(snapshot());
    transport.receive('chart_candle', candleJson(close: 104, version: 4));
    await Future<void>.delayed(Duration.zero);
    expect(notifier.state.snapshot!.date, '2026-10-06');
    expect(notifier.state.snapshot!.candles, isEmpty);
    repo.response = (_) => Future.error(StateError('offline'));
    await notifier.refresh();
    expect(notifier.state.error, isNotNull);
    expect(notifier.state.snapshot!.date, '2026-10-06');
    notifier.dispose();
    client.dispose();
    repo.dispose();
  });
  for (final width in [390.0, 1440.0]) {
    testWidgets(
        'dashboard renders and toggles chart at width $width without overflow',
        (tester) async {
      tester.view.physicalSize = Size(width, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = FakeRepository();
      final client = TelemetryWebSocketClient(transport: FakeTransport());
      await tester.pumpWidget(ProviderScope(
          overrides: [
            telemetryWsClientProvider.overrideWithValue(client),
            chartProvider.overrideWith(
                (ref) => ChartNotifier(repo, client, polling: false)),
          ],
          child: MaterialApp(
              theme: ThemeData.dark(),
              home: const TelemetryDashboardScreen())));
      await tester.pumpAndSettle();
      expect(find.text('Nasdaq 100'), findsOneWidget);
      expect(find.byType(MarketChart), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Línea'));
      await tester.pumpAndSettle();
      expect(tester.widget<MarketChart>(find.byType(MarketChart)).line, true);
      await tester.tap(find.text('5m'));
      await tester.pumpAndSettle();
      expect(tester.widget<MarketChart>(find.byType(MarketChart)).candles,
          hasLength(6));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      client.dispose();
      repo.dispose();
    });
  }
}
