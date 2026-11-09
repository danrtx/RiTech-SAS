import 'package:flutter/material.dart';

enum MetricStatus { loading, empty, ready, error }

const _panel = Color(0xFF111923);
const _border = Color(0xFF253141);
const _muted = Color(0xFF8D9CB1);
const _green = Color(0xFF42D3A5);
const _red = Color(0xFFFF6B6B);

class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.title,
    required this.value,
    this.subtitle,
    this.status = MetricStatus.ready,
    this.icon,
    this.valueColor,
    this.errorMessage,
  });

  final String title;
  final String value;
  final String? subtitle;
  final MetricStatus status;
  final IconData? icon;
  final Color? valueColor;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _panel,
        border: Border.all(
          color: status == MetricStatus.error
              ? _red.withValues(alpha: 0.3)
              : _border,
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 14, color: _muted),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: const TextStyle(
                    color: _muted,
                    fontSize: 10,
                    letterSpacing: 1.2,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              _statusDot(),
            ],
          ),
          const SizedBox(height: 12),
          _buildContent(),
        ],
      ),
    );
  }

  Widget _statusDot() {
    final color = switch (status) {
      MetricStatus.loading => Colors.amber,
      MetricStatus.empty => _muted,
      MetricStatus.ready => _green,
      MetricStatus.error => _red,
    };
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }

  Widget _buildContent() {
    return switch (status) {
      MetricStatus.loading => const Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 1.5,
                color: _green,
              ),
            ),
            SizedBox(width: 10),
            Text(
              'Cargando...',
              style: TextStyle(color: _muted, fontSize: 12),
            ),
          ],
        ),
      MetricStatus.empty => const Text(
          'Sin datos disponibles',
          style: TextStyle(color: _muted, fontSize: 13),
        ),
      MetricStatus.error => Text(
          errorMessage ?? 'Error al obtener datos',
          style: const TextStyle(color: _red, fontSize: 12),
        ),
      MetricStatus.ready => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 22,
                fontFamily: 'monospace',
                fontWeight: FontWeight.w600,
                color: valueColor ?? Colors.white,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(
                subtitle!,
                style: const TextStyle(color: _muted, fontSize: 11),
              ),
            ],
          ],
        ),
    };
  }
}
