# Motor ATR de un minuto

Biblioteca Dart pura: transforma ticks en velas cerradas UTC, calcula ATR Wilder y publica resultados/alertas mediante streams broadcast. La integración con `backend/` (NestJS) y `frontend_mobile/` (Flutter) está pendiente; el ejemplo usa datos sintéticos. No conecta Flutter a Redis.

## Ejecutar y verificar

Verificado con Flutter 3.47.6 y Dart 3.13.5. Desde esta carpeta:

```powershell
dart pub get
dart test
flutter analyze
dart format --output=none --set-exit-if-changed .
dart run example/main.dart
```

`example/main.dart` carga `example/config.json`, conecta caché, reloj, métricas y streams, introduce 40 minutos sintéticos por símbolo y realiza un ciclo de recuperación. El reloj de producción del ejemplo usa `clock.now`; el motor exige una función de reloj y otra de duración monotónica por constructor. No usa DateTime.now directamente. Las únicas dependencias del núcleo son de desarrollo: test, fake_async y clock para tests/ejemplo.

## Integración

1. Crear AtrConfig desde JSON o constructor e InMemoryTickCache con el mismo reloj/configuración.
2. Crear AtrEngine con caché, reloj, `elapsed: () => stopwatch.elapsed` y LogSink opcional.
3. Conectar `onLog` de la caché a `engine.recordLog` como en el ejemplo para sumar los descartes de ingestión a las métricas del motor.
4. Insertar ticks recibidos por la API del backend mediante `cache.add(tick)`; devuelve false si se descartan.
5. Suscribirse a `engine.results` y `engine.alerts` antes de procesar. Los streams son asíncronos: terminar runCycle no garantiza que el consumidor haya recibido todos los eventos. No conservan historial ni replay; el consumidor guarda el último estado si lo necesita.
6. Llamar start para el próximo minuto; resume recupera inmediatamente y programa los siguientes. Integrar Flutter con el paquete hermano `atr_engine_flutter`.
7. Cancelar suscripciones y llamar dispose al destruir el propietario. stop/pausa invalidan lecturas pendientes; resume las recupera. Dispose es idempotente y cierra streams.

Un proveedor alternativo implementa TickCache.read(symbol, from, until). Debe devolver snapshot estable en orden de recepción, intervalo `[from,until)`, y coverageStart si perdió minutos por retención. Debe validar y contar ticks rechazados en ingestión, deduplicar IDs dentro de su retención y rechazar ticks tardíos de minutos cerrados. El agregador vuelve a validar los snapshots y cuenta errores; no ordena datos defectuosos ni revisa velas ya publicadas.

La caché en memoria sella los minutos anteriores a `until` al leer, mantiene deduplicación entre ciclos y rechaza llegadas tardías. `maxTicks` limita el tamaño global inmediatamente; la retención temporal se poda al leer. Una expulsión parcial invalida todo ese minuto mediante coverageStart para evitar OHLC incompleto. Dimensionar ambas cotas para el volumen real de símbolos; no se ha realizado benchmark con un feed de producción. El estado y la caché se pierden al cerrar el proceso.

## Reglas de datos y cálculo

- UTC `[hh:mm:00, siguiente minuto)`, usando precio del primer/último tick aceptado para apertura/cierre. La vela abierta no participa.
- TR inicial=high-low. Después=max(high-low, abs(high-closePrev), abs(low-closePrev)). ATR inicial=media de N TR; siguientes=(ATRprev*(N-1)+TR)/N. La implementación distribuye la división para reducir riesgo de overflow.
- Menos de N velas reales: InsufficientData sin ATR/alertas. ATR disponible pero base incompleta: BaselineWarmingUp. Base lista: Ready.
- Línea base=media de los M ATR anteriores, excluyendo el actual. El primer ATR puede aparecer tras N velas y la primera alerta tras N+M velas.
- Umbral inclusivo: actual>=multiplicador*base. Se acepta igualdad numérica si la diferencia es <=epsilon*max(abs(actual), abs(objetivo)). Con epsilon=1e-12, un valor apenas inferior dentro de esa banda se considera igual; fuera de la banda no dispara. Epsilon=0 exige comparación estricta. No hay piso absoluto que distorsione valores pequeños.
- Base cero/actual cero no alerta; base cero/actual positivo sí. Cooldown por símbolo y timestamp de vela; cero permite alertas consecutivas. Las alertas históricas recuperadas mantienen el minuto original y emittedAt indica cuándo se generaron.
- Minutos sin ticks se marcan como huecos, sin forward-fill. Hasta K minutos faltantes mantienen el último cierre; más de K reinician ATR, base y cooldown. Exactamente K no reinicia. Se detecta también un hueco al final de un ciclo vacío y se reinicia una sola vez por hueco.
- Una pausa larga con cobertura completa recupera todas las velas sin reset artificial. Si faltan datos por retención, se registra coverageLost y aplica la misma regla de huecos. Después de un reset vuelve el warm-up.
- Se descartan y cuentan precios nulos/<=0/NaN/infinito, timestamps inválidos/futuros, duplicados y retrocesos temporales. Tick.parse exige ISO 8601 con zona explícita y valida fecha calendario; admite fracciones de hasta seis dígitos. Un proveedor que construya DateTime directamente es responsable de parsearlo correctamente.
- Identidad de duplicado: ID de origen por símbolo, o timestamp/precio exactos si no hay ID. Este fallback puede colapsar operaciones legítimas idénticas; preferir IDs de origen. Ticks distintos con igual timestamp se conservan en orden de recepción.

## Scheduler, fallos y métricas

Timer de un disparo recalculado hasta el siguiente minuto UTC. Guardia de reentrada compartida entre timer y resume; una reanudación durante lectura pendiente queda encolada. Los cambios de reloj hacia atrás no reprocesan minutos; hacia adelante recuperan los disponibles. Una suspensión completa requiere resume del host; no se promete ejecución con la app cerrada.

Lecturas concurrentes por símbolo, timeout configurable, fallos aislados y reintento en el próximo ciclo. Las respuestas tardías no mutan el estado. Los cálculos de cada vela se preparan sobre copias y se confirman juntos: un fallo no deja semilla/base parcialmente actualizadas. Solo se avanza el cursor tras lectura/procesamiento satisfactorio o velas ya confirmadas. Un ciclo vacío satisfactorio sella el intervalo: ticks posteriores para ese intervalo son tardíos.

EngineMetrics expone ciclos, ciclos omitidos, duración monotónica del último ciclo, descartes por motivo, reinicios, errores y alertas. EngineLog incluye código, símbolo, cantidad y error opcional. Los sinks de logging no pueden interrumpir el procesamiento. Los estados Gap, CacheError e InsufficientData comunican ausencia de resultado actual; no reutilizan silenciosamente un ATR obsoleto.

## Configuración

Todos los parámetros se encuentran en `example/config.json`: símbolos, periodo, umbral, ventana de base, K, cooldown, epsilon, retención, máximo de ticks y timeout. Se validan rangos y retención mínima de N+M minutos; aun así, los huecos pueden requerir más historia para completar el warm-up.

Los tests fakeAsync cubren alineación, deriva, reentrada, timeouts, pausa/resume y saltos de reloj. `test/fixtures/README.md` explica la referencia pandas y la tolerancia <=1e-6. No se requiere Docker, Android SDK o emulador para estos tests unitarios.
