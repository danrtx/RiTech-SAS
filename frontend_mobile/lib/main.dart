import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/firebase/firebase_bootstrap.dart';
import 'features/notifications/application/push_notifications_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final pushEnabled = await FirebaseBootstrap.initialize();
  runApp(
    ProviderScope(
      overrides: [pushEnabledProvider.overrideWithValue(pushEnabled)],
      child: const RiTechApp(),
    ),
  );
}
