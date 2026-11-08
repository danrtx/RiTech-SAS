import 'dart:math' as math;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import '../../domain/chart_data.dart';

const chartUp = Color(0xFF42D3A5);
const chartDown = Color(0xFFFF7285);
const chartMuted = Color(0xFF8D9CB1);

class MarketChart extends StatefulWidget {
  const MarketChart(
      {super.key,
      required this.candles,
      required this.interval,
      required this.line});
  final List<ChartCandle> candles;
  final int interval;
  final bool line;
  @override
  State<MarketChart> createState() => _MarketChartState();
}

class _MarketChartState extends State<MarketChart> {
  double? _start, _end;
  double _gestureStart = 0, _gestureEnd = 0, _gestureX = 0;
  Offset? _pointer;
  double _width = 600;
  double get _step => widget.interval * 60000.0;
  double get _fullStart => widget.candles.first.startTimeMs - _step;
  double get _fullEnd => widget.candles.last.startTimeMs + _step;
  double get _left => _start ?? _fullStart;
  double get _right => _end ?? _fullEnd;

  @override
  void didUpdateWidget(covariant MarketChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.interval != widget.interval ||
        oldWidget.candles.isEmpty ||
        widget.candles.isEmpty ||
        oldWidget.candles.first.date != widget.candles.first.date) {
      _start = _end = null;
      _pointer = null;
    }
  }

  void _range(double start, double end) {
    final full = _fullEnd - _fullStart;
    final span = (end - start).clamp(math.min(full, _step * 8), full);
    final clampedStart = start.clamp(_fullStart, _fullEnd - span);
    setState(() {
      _start = clampedStart;
      _end = clampedStart + span;
    });
  }

  void _zoom(double scale) {
    final center = (_left + _right) / 2;
    final span = (_right - _left) * scale;
    _range(center - span / 2, center + span / 2);
  }

  @override
  Widget build(BuildContext context) {
    if (widget.candles.isEmpty) {
      return const SizedBox(
          height: 390,
          child: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.candlestick_chart_outlined, size: 42, color: chartMuted),
            SizedBox(height: 16),
            Text('Aún no hay precios guardados para esta fecha',
                style: TextStyle(color: Colors.white)),
            SizedBox(height: 8),
            Text('Selecciona otra jornada o espera los primeros registros.',
                textAlign: TextAlign.center,
                style: TextStyle(color: chartMuted)),
          ])));
    }
    return LayoutBuilder(builder: (context, constraints) {
      _width = math.max(1, constraints.maxWidth - 88);
      final visible = widget.candles
          .where((c) => c.startTimeMs >= _left && c.startTimeMs <= _right)
          .toList();
      ChartCandle? selected;
      if (_pointer != null && visible.isNotEmpty) {
        final time = _left +
            ((_pointer!.dx - 12) / _width).clamp(0, 1) * (_right - _left);
        selected = visible.reduce((a, b) =>
            (a.startTimeMs - time).abs() < (b.startTimeMs - time).abs()
                ? a
                : b);
      }
      final quote = selected ?? widget.candles.last;
      final color = quote.close >= quote.open ? chartUp : chartDown;
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: Wrap(spacing: 18, runSpacing: 6, children: [
              Text('${quote.timeLabel} ET',
                  style: const TextStyle(color: chartMuted, fontSize: 12)),
              for (final entry in {
                'O': quote.open,
                'H': quote.high,
                'L': quote.low,
                'C': quote.close
              }.entries)
                Text.rich(
                    TextSpan(children: [
                      TextSpan(
                          text: '${entry.key} ',
                          style: const TextStyle(color: chartMuted)),
                      TextSpan(
                          text: entry.value.toStringAsFixed(2),
                          style: TextStyle(color: color))
                    ]),
                    style:
                        const TextStyle(fontSize: 12, fontFamily: 'monospace')),
              Text('VOL ${quote.volume?.toStringAsFixed(0) ?? '—'}',
                  style: const TextStyle(color: chartMuted, fontSize: 12)),
            ])),
        const SizedBox(height: 10),
        Semantics(
            label:
                'Gráfica ${widget.line ? 'de línea' : 'de velas'}. Último precio ${quote.close.toStringAsFixed(2)} dólares. '
                'Máximo ${quote.high.toStringAsFixed(2)}, mínimo ${quote.low.toStringAsFixed(2)}. Usa los botones para ampliar.',
            child: Listener(
                onPointerSignal: (event) {
                  if (event is PointerScrollEvent) {
                    GestureBinding.instance.pointerSignalResolver.register(
                        event,
                        (_) => _zoom(event.scrollDelta.dy > 0 ? 1.2 : 0.8));
                  }
                },
                child: MouseRegion(
                    cursor: SystemMouseCursors.precise,
                    onHover: (event) =>
                        setState(() => _pointer = event.localPosition),
                    onExit: (_) => setState(() => _pointer = null),
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTapDown: (event) =>
                          setState(() => _pointer = event.localPosition),
                      onScaleStart: (event) {
                        _gestureStart = _left;
                        _gestureEnd = _right;
                        _gestureX = event.localFocalPoint.dx;
                      },
                      onScaleUpdate: (event) {
                        final originalSpan = _gestureEnd - _gestureStart;
                        final span = originalSpan / event.scale;
                        final center = (_gestureStart + _gestureEnd) / 2 -
                            (event.localFocalPoint.dx - _gestureX) /
                                _width *
                                originalSpan;
                        _range(center - span / 2, center + span / 2);
                      },
                      child: SizedBox(
                          height: constraints.maxWidth < 600 ? 300 : 405,
                          width: double.infinity,
                          child: CustomPaint(
                              painter: _ChartPainter(
                                  candles: visible,
                                  selected: selected,
                                  start: _left,
                                  end: _right,
                                  step: _step,
                                  line: widget.line,
                                  opening: widget.candles.first.open))),
                    )))),
        Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 14, 12),
            child: Row(children: [
              const Expanded(
                  child: Text('Nueva York (ET)  ·  Arrastra para explorar',
                      style: TextStyle(color: chartMuted, fontSize: 11))),
              IconButton(
                  tooltip: 'Alejar',
                  visualDensity: VisualDensity.compact,
                  onPressed: () => _zoom(1.4),
                  icon: const Icon(Icons.remove, size: 17)),
              IconButton(
                  tooltip: 'Acercar',
                  visualDensity: VisualDensity.compact,
                  onPressed: () => _zoom(0.7),
                  icon: const Icon(Icons.add, size: 17)),
              IconButton(
                  tooltip: 'Ver jornada completa',
                  visualDensity: VisualDensity.compact,
                  onPressed: () => setState(() {
                        _start = _end = null;
                      }),
                  icon: const Icon(Icons.fit_screen, size: 18)),
            ])),
      ]);
    });
  }
}

class _ChartPainter extends CustomPainter {
  _ChartPainter(
      {required this.candles,
      required this.start,
      required this.end,
      required this.step,
      required this.line,
      required this.opening,
      this.selected});
  final List<ChartCandle> candles;
  final ChartCandle? selected;
  final double start, end, step, opening;
  final bool line;

  void _text(Canvas canvas, String text, Offset offset,
      {Color color = chartMuted, double size = 10}) {
    final painter = TextPainter(
        text: TextSpan(
            text: text,
            style: TextStyle(
                color: color, fontSize: size, fontFamily: 'monospace')),
        textDirection: TextDirection.ltr)
      ..layout();
    painter.paint(canvas, offset);
  }

  void _dash(Canvas canvas, Offset a, Offset b, Color color) {
    final length = (b - a).distance;
    if (length == 0) return;
    final direction = (b - a) / length;
    for (double d = 0; d < length; d += 7) {
      canvas.drawLine(
          a + direction * d,
          a + direction * math.min(d + 3, length),
          Paint()
            ..color = color
            ..strokeWidth = 1);
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTRB(12, 14, size.width - 76, size.height - 104);
    if (plot.width <= 0 || candles.isEmpty) return;
    final low = candles.map((c) => c.low).reduce(math.min);
    final high = candles.map((c) => c.high).reduce(math.max);
    final seriesColor = candles.last.close >= opening ? chartUp : chartDown;
    final padding = math.max((high - low) * 0.15, high * 0.0001);
    final minPrice = low - padding, maxPrice = high + padding;
    double x(int time) =>
        plot.left + (time - start) / (end - start) * plot.width;
    double y(double price) =>
        plot.bottom - (price - minPrice) / (maxPrice - minPrice) * plot.height;
    final grid = Paint()
      ..color = const Color(0xFF202B3A)
      ..strokeWidth = 0.7;
    for (var i = 0; i <= 5; i++) {
      final price = minPrice + (maxPrice - minPrice) * i / 5;
      canvas.drawLine(
          Offset(plot.left, y(price)), Offset(plot.right, y(price)), grid);
      _text(canvas, price.toStringAsFixed(2),
          Offset(plot.right + 10, y(price) - 6));
    }
    final labelCount = size.width < 600 ? 3 : 6;
    final labelled = <int>{};
    for (var i = 0; i <= labelCount; i++) {
      final index = (i * (candles.length - 1) / labelCount).round();
      if (!labelled.add(index)) continue;
      final candle = candles[index];
      final px = x(candle.startTimeMs);
      canvas.drawLine(Offset(px, plot.top), Offset(px, size.height - 30), grid);
      _text(
          canvas,
          candle.timeLabel,
          Offset(
              (px - 14).clamp(plot.left, plot.right - 26), size.height - 21));
    }
    canvas.save();
    canvas.clipRect(plot.inflate(1));
    if (opening > minPrice && opening < maxPrice) {
      _dash(canvas, Offset(plot.left, y(opening)),
          Offset(plot.right, y(opening)), const Color(0xFF536174));
    }
    final bodyWidth =
        math.max(1.0, math.min(14.0, step / (end - start) * plot.width * 0.68));
    if (line) {
      // Preserve gaps: missing minutes are not fabricated or connected as recorded prices.
      var segment = <ChartCandle>[];
      void drawSegment() {
        if (segment.isEmpty) return;
        final path = Path()
          ..moveTo(x(segment.first.startTimeMs), y(segment.first.close));
        for (final candle in segment.skip(1)) {
          path.lineTo(x(candle.startTimeMs), y(candle.close));
        }
        final fill = Path.from(path)
          ..lineTo(x(segment.last.startTimeMs), plot.bottom)
          ..lineTo(x(segment.first.startTimeMs), plot.bottom)
          ..close();
        canvas.drawPath(
            fill,
            Paint()
              ..shader = LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    seriesColor.withValues(alpha: 0.19),
                    seriesColor.withValues(alpha: 0.01)
                  ]).createShader(plot));
        canvas.drawPath(
            path,
            Paint()
              ..color = seriesColor
              ..style = PaintingStyle.stroke
              ..strokeWidth = 2);
        if (segment.length == 1) {
          canvas.drawCircle(
              Offset(x(segment.first.startTimeMs), y(segment.first.close)),
              2,
              Paint()..color = seriesColor);
        }
      }

      for (final candle in candles) {
        if (segment.isNotEmpty &&
            candle.startTimeMs - segment.last.startTimeMs > step * 1.5) {
          drawSegment();
          segment = [];
        }
        segment.add(candle);
      }
      drawSegment();
    } else {
      for (final candle in candles) {
        final paint = Paint()
          ..color = candle.close >= candle.open ? chartUp : chartDown
          ..strokeWidth = 1;
        final px = x(candle.startTimeMs);
        canvas.drawLine(
            Offset(px, y(candle.high)), Offset(px, y(candle.low)), paint);
        final top = math.min(y(candle.open), y(candle.close));
        canvas.drawRect(
            Rect.fromLTWH(px - bodyWidth / 2, top, bodyWidth,
                math.max(1.4, (y(candle.open) - y(candle.close)).abs())),
            paint);
      }
    }
    canvas.restore();
    final volumeTop = plot.bottom + 21, volumeBottom = size.height - 32;
    final maxVolume = candles.map((c) => c.volume ?? 0).reduce(math.max);
    _text(canvas, maxVolume > 0 ? 'VOLUMEN' : 'VOLUMEN NO DISPONIBLE',
        Offset(plot.left, volumeTop - 9),
        size: 9);
    if (maxVolume > 0) {
      for (final candle in candles) {
        if (candle.volume == null) continue;
        final height =
            candle.volume! / maxVolume * (volumeBottom - volumeTop - 6);
        canvas.drawRect(
            Rect.fromLTWH(x(candle.startTimeMs) - bodyWidth / 2,
                volumeBottom - height, bodyWidth, height),
            Paint()
              ..color = (candle.close >= candle.open ? chartUp : chartDown)
                  .withValues(alpha: 0.4));
      }
    }
    final last = candles.last;
    final lastY = y(last.close).clamp(plot.top, plot.bottom);
    final color = last.close >= last.open ? chartUp : chartDown;
    _dash(canvas, Offset(plot.left, lastY), Offset(plot.right, lastY),
        color.withValues(alpha: 0.5));
    canvas.drawRRect(
        RRect.fromRectAndRadius(
            Rect.fromLTWH(plot.right + 3, lastY - 10, 69, 21),
            const Radius.circular(3)),
        Paint()..color = color);
    _text(canvas, last.close.toStringAsFixed(2),
        Offset(plot.right + 9, lastY - 6),
        color: const Color(0xFF091017), size: 11);
    if (selected != null) {
      final px = x(selected!.startTimeMs), py = y(selected!.close);
      _dash(canvas, Offset(px, plot.top), Offset(px, volumeBottom),
          const Color(0xFF99A9BF));
      _dash(canvas, Offset(plot.left, py), Offset(plot.right, py),
          const Color(0xFF99A9BF));
      canvas.drawCircle(Offset(px, py), 4, Paint()..color = Colors.white);
      final labelX = (px - 25).clamp(plot.left, plot.right - 50);
      canvas.drawRRect(
          RRect.fromRectAndRadius(
              Rect.fromLTWH(labelX, size.height - 24, 51, 22),
              const Radius.circular(3)),
          Paint()..color = const Color(0xFF344256));
      _text(canvas, selected!.timeLabel, Offset(labelX + 9, size.height - 19),
          color: Colors.white);
    }
  }

  @override
  bool shouldRepaint(covariant _ChartPainter oldDelegate) => true;
}
