import 'dart:async';
import 'models.dart';

/// Wall-clock aligned, single-shot scheduler. The engine owns reentry protection.
class MinuteScheduler {
  MinuteScheduler({required this.now, required this.onMinute});
  final Now now;
  final Future<void> Function() onMinute;
  Timer? _timer;
  bool _running = false;
  bool get running => _running;
  void start() {
    if (_running) {
      return;
    }
    _running = true;
    _schedule();
  }

  void _schedule() {
    if (!_running) {
      return;
    }
    final current = now().toUtc();
    final next = minuteUtc(current).add(const Duration(minutes: 1));
    _timer = Timer(next.difference(current), () {
      _schedule();
      unawaited(onMinute());
    });
  }

  void stop() {
    _running = false;
    _timer?.cancel();
    _timer = null;
  }
}
