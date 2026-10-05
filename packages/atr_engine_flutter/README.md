# Adaptador Flutter para ATR

Conecta AtrEngine al ciclo de vida Flutter mediante WidgetsBindingObserver. El motor conserva toda su lógica en Dart puro. Este paquete no crea pantallas ni un feed y no accede directamente a Redis.

En el propietario del motor, después de inicializar WidgetsFlutterBinding:

```dart
final observer = AtrLifecycleObserver(engine);
// Los ticks recibidos desde la API del backend se insertan en la caché.
// Escuchar engine.results y engine.alerts para actualizar el estado de la app.

// Al destruir el propietario:
observer.dispose();
await engine.dispose();
```

Importar `package:atr_engine_flutter/atr_engine_flutter.dart` y construir engine como en `../atr_engine/example/main.dart`. El reloj es obligatorio e inyectable; el host puede usar clock.now. El adaptador inicia el scheduler si la app está activa; en inactive/hidden/paused/detached pausa e invalida lecturas pendientes. En resumed solicita recuperación inmediata de minutos cerrados y realinea el timer. La baja del observer es idempotente; el propietario mantiene responsabilidad sobre dispose del motor y suscripciones.

Los sistemas móviles pueden suspender timers. La recuperación usa los ticks retenidos; si un feed también se pausa, los huecos reales se marcan y los largos reinician Wilder. No garantiza servicio de cálculo con la aplicación terminada.

Desde esta carpeta:

```powershell
flutter pub get
flutter test
flutter analyze
dart format --output=none --set-exit-if-changed .
```

El test de widgets simula pausa/reanudación y verifica que dispose retire el observer y detenga timers. No requiere iniciar un emulador. Este adaptador es opcional para cálculo local: `frontend_mobile/` consume el ATR operativo del backend NestJS mediante Socket.IO y no instancia este motor local.
