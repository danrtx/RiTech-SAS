import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/firebase/firebase_bootstrap.dart';
import 'features/notifications/application/push_notifications_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Si Firebase no está configurado en este build, la app arranca igual sin push.
  final pushEnabled = await FirebaseBootstrap.initialize();
  runApp(
    ProviderScope(
      // Informa a los providers de notificaciones si Firebase quedó disponible.
      overrides: [pushEnabledProvider.overrideWithValue(pushEnabled)],
      child: const RiTechApp(),
    ),
  );
}
