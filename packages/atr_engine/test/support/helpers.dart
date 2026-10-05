import 'package:atr_engine/atr_engine.dart';

final epoch = DateTime.utc(2026, 10, 4, 12);
Tick tick(
  int minute,
  double? price, {
  String symbol = 'A',
  int second = 0,
  String? id,
}) => Tick(
  symbol: symbol,
  price: price,
  timestamp: epoch.add(Duration(minutes: minute, seconds: second)),
  id: id,
);
Candle candle(
  int minute, {
  double high = 12,
  double low = 10,
  double close = 11,
}) => Candle(
  minute: epoch.add(Duration(minutes: minute)),
  open: low,
  high: high,
  low: low,
  close: close,
);

class StubCache implements TickCache {
  StubCache(this.load);
  final Future<TickSnapshot> Function(String, DateTime, DateTime) load;
  int reads = 0;
  @override
  Future<TickSnapshot> read(
    String symbol, {
    required DateTime from,
    required DateTime until,
  }) {
    reads++;
    return load(symbol, from, until);
  }
}
