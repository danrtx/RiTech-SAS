import 'dart:math' as math;
import 'package:flutter/material.dart';

const _green = Color(0xFF42D3A5);
const _red = Color(0xFFFF6B6B);
const _muted = Color(0xFF8D9CB1);
const _border = Color(0xFF253141);

class ProfitabilityChart extends StatelessWidget {
  const ProfitabilityChart({
    super.key,
    required this.pnlSeries,
    this.height = 200,
  });

  final List<double> pnlSeries;
  final double height;

  @override
  Widget build(BuildContext context) {
    if (pnlSeries.isEmpty) {
      return SizedBox(
        height: height,
        child: const Center(
          child: Text(
            'Sin datos de rentabilidad',
            style: TextStyle(color: _muted, fontSize: 12),
          ),
        ),
      );
    }

    return SizedBox(
      height: height,
      child: CustomPaint(
        size: Size.infinite,
        painter: _PnlPainter(pnlSeries),
      ),
    );
  }
}

class _PnlPainter extends CustomPainter {
  _PnlPainter(this.series);
  final List<double> series;

  @override
  void paint(Canvas canvas, Size size) {
    if (series.length < 2) return;

    final maxVal = series.map((v) => v.abs()).reduce(math.max);
    final yRange = maxVal == 0 ? 1.0 : maxVal * 1.15;
    final midY = size.height / 2;

    final gridPaint = Paint()
      ..color = _border
      ..strokeWidth = 0.5;
    canvas.drawLine(
      Offset(0, midY),
      Offset(size.width, midY),
      gridPaint,
    );

    final path = Path();
    final fillPath = Path();
    final dx = size.width / (series.length - 1);

    for (var i = 0; i < series.length; i++) {
      final x = i * dx;
      final y = midY - (series[i] / yRange) * midY;
      if (i == 0) {
        path.moveTo(x, y);
        fillPath.moveTo(x, midY);
        fillPath.lineTo(x, y);
      } else {
        path.lineTo(x, y);
        fillPath.lineTo(x, y);
      }
    }

    fillPath.lineTo(size.width, midY);
    fillPath.close();

    final lastValue = series.last;
    final color = lastValue >= 0 ? _green : _red;

    canvas.drawPath(
      fillPath,
      Paint()..color = color.withValues(alpha: 0.08),
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );

    final lastX = (series.length - 1) * dx;
    final lastY = midY - (lastValue / yRange) * midY;
    canvas.drawCircle(Offset(lastX, lastY), 3, Paint()..color = color);

    final zeroLabel = TextPainter(
      text: const TextSpan(
        text: '0%',
        style: TextStyle(color: _muted, fontSize: 9),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    zeroLabel.paint(canvas, Offset(4, midY - zeroLabel.height - 2));
  }

  @override
  bool shouldRepaint(_PnlPainter old) => old.series != series;
}
