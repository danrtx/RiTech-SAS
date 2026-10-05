import 'dart:async';
import 'package:atr_engine/atr_engine.dart';
import 'package:flutter/widgets.dart';

/// The caller owns the engine and must dispose it separately.
class AtrLifecycleObserver with WidgetsBindingObserver {
  AtrLifecycleObserver(this.engine, {WidgetsBinding? binding})
    : _binding = binding ?? WidgetsBinding.instance {
    _binding.addObserver(this);
    final state = _binding.lifecycleState;
    if (state == null || state == AppLifecycleState.resumed) {
      engine.start();
    } else {
      engine.pause();
    }
  }
  final AtrEngine engine;
  final WidgetsBinding _binding;
  bool _disposed = false;
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_disposed) {
      return;
    }
    if (state == AppLifecycleState.resumed) {
      unawaited(engine.resume());
    } else {
      engine.pause();
    }
  }

  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _binding.removeObserver(this);
    engine.stop();
  }
}
