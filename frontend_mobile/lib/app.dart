import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/config/app_config.dart';
import 'core/router/app_router.dart';
import 'features/notifications/application/push_notifications_controller.dart';
import 'features/notifications/domain/hedging_alert.dart';

class RiTechApp extends ConsumerStatefulWidget {
  const RiTechApp({super.key});

  @override
  ConsumerState<RiTechApp> createState() => _RiTechAppState();
}

class _RiTechAppState extends ConsumerState<RiTechApp> {
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  late final PushNotificationsController _push;

  @override
  void initState() {
    super.initState();
    _push = ref.read(pushNotificationsProvider.notifier);
    // Tras el primer frame el router está montado: se reproduce un deep link pendiente.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _push.attachNavigator(ref.read(appRouterProvider).go);
    });
  }

  @override
  void dispose() {
    _push.detachNavigator();
    super.dispose();
  }

  void _showInAppAlert(HedgingAlert alert) {
    _messenger.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(
            'Hedging activado en ${alert.symbol}: ${alert.policy.label.toLowerCase()}'),
        action: SnackBarAction(
            label: 'Ver', onPressed: () => _push.openAlert(alert.correlationId)),
      ));
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    ref.listen(pushNotificationsProvider.select((s) => s.lastForegroundAlert),
        (previous, next) {
      if (next != null && !identical(previous, next)) _showInAppAlert(next);
    });

    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: _messenger,
      locale: const Locale('es', 'CO'),
      supportedLocales: const [Locale('es', 'CO'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0D1117),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF42D3A5),
          secondary: Color(0xFF1F6FEB),
          surface: Color(0xFF161B22),
        ),
      ),
      routerConfig: router,
    );
  }
}
