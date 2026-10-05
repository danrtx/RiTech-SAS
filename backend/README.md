# Backend: ATR, caché y validación de streaming

El cálculo operativo vive en `src/modules/atr/` y se conecta al servicio Redis y a la telemetría NestJS. El paquete `../packages/atr_engine` conserva la implementación Dart y la referencia externa compartida para comprobar paridad. Flutter consume resultados del backend; no necesita calcular el ATR operativo en el teléfono.

## Inicio local

Desde la raíz del repositorio, copiar `.env.example` a `.env` si aún no existe y ejecutar `docker compose up -d`. Después, desde `backend/`:

```powershell
npm ci
npm run start:dev
```

`GET http://localhost:3000/health` comprueba PostgreSQL y Redis. `GET http://localhost:3000/atr` expone último resultado por símbolo, métricas del motor, estado de recuperación y contadores de ingestión. Sin ticks, el resultado es `insufficientData`, no un ATR inventado. El timer se alinea al siguiente minuto UTC y se cancela durante shutdown.

## Demostración con datos sintéticos

Terminal 1, desde `backend/`:

```powershell
npm run mock:feed
```

Terminal 2, desde `backend/`:

```powershell
$env:MOCK_FEED_URL = 'ws://127.0.0.1:4100'
$env:TICK_KEY_PREFIX = 'ritech:demo:v1'
npm run start:dev
```

El mock proporciona 40 minutos de historia y luego ticks vivos para los símbolos configurados. El último minuto histórico incluye un aumento deliberado del rango. La recuperación evita cerrar minutos mientras se repone la historia; el ATR se publica en el siguiente ciclo alineado. El mock está limitado a loopback, deshabilitado por defecto y prohibido con NODE_ENV=production. Su historial está acotado a 100000 ticks; reiniciar el escenario cuando se alcance el límite. No es un conector NASDAQ real.

Para repetir el demo desde cero, usar otro TICK_KEY_PREFIX exclusivo; un prefix ya utilizado puede tener minutos sellados. No reutilizar el prefijo operativo para inyectar datos sintéticos.

El frontend usa Socket.IO en `http://localhost:3000/telemetry`. En un emulador Android, configurar la dirección accesible del host, por ejemplo `--dart-define=WS_BASE_URL=http://10.0.2.2:3000/telemetry`. Las carpetas de plataforma móvil se gestionan en el proyecto Flutter del equipo.

## Contrato para el conector del equipo

Inyectar `TelemetryService` y llamar:

```typescript
await telemetry.processIncomingTick({
  id: 'provider:session:sequence',
  symbol: 'NDX',
  price: 20123.45,
  volume: 1,
  eventTime: 1791115200000, // Unix ms UTC del proveedor, no la hora del reenvío
});
```

El ejemplo muestra la forma del dato; usar timestamps actuales reales al operar. `receivedAt` lo añade el backend. El adaptador debe producir IDs estables y únicos por símbolo, también al reconectar. No sustituir eventTime en replay. La función devuelve `{accepted:true}` o `{accepted:false,reason}`. Fallos de Redis rechazan la promesa: no confirmar el offset del proveedor hasta persistir o reconocer un duplicado ya persistido.

Cuando un proveedor permita recuperación de historia, llamar `IngestionState.beginRecovery()` antes de iniciar/reconectar y `recovered()` únicamente cuando todo el replay esté persistido. Este estado evita que el ATR selle los minutos que aún se están recuperando. Debe usarse un único coordinador de ingestión por proceso; múltiples proveedores necesitarían coordinación adicional. Una desconexión no detectada o un proveedor sin replay no garantizan continuidad: se deben registrar los datos perdidos y aplicar la política de huecos.

`processIncomingTick(symbol, price, volume)`, `setTick`, `pushATRWindow` y `getATRWindow` fueron sustituidos por el contrato tipado y `appendTick/readTicks`. No había consumidores de esos métodos fuera de TelemetryService en el checkout revisado. Cualquier rama del conector debe adaptarse al nuevo contrato antes de integrarse.

## Redis

Por símbolo se usan tres claves, con hash slot compartido:

```text
<TICK_KEY_PREFIX>:{NDX}:index  # sorted set: score=eventTime, member=id
<TICK_KEY_PREFIX>:{NDX}:data   # hash: id -> payload original y secuencia de recepción
<TICK_KEY_PREFIX>:{NDX}:meta   # última marca temporal, sello y cobertura perdida
```

Scripts Lua hacen atómicos deduplicación, inserción, poda y snapshots. La secuencia desempata ticks con el mismo milisegundo conservando su orden de recepción. El JSON original preserva la precisión de los doubles al atravesar Lua. El snapshot de `[from,until)` sella los minutos anteriores a until; ticks posteriores para esos minutos se descartan como tardíos. No se usa SCAN ni KEYS para leer la ventana.

Se rechazan precio nulo/no positivo/NaN/infinito, volumen inválido, ID o símbolo inválidos, timestamps inválidos/futuros, duplicados, desorden temporal y ticks expirados. Los motivos quedan contabilizados; los logs de descartes están limitados por agregación para no saturar bajo carga. La deduplicación cubre los IDs retenidos; los antiguos quedan fuera por retención/sello temporal.

La retención predeterminada es 1440 minutos y 100000 ticks por símbolo, configurable. Si una expulsión elimina parte de una vela, esa vela entera se excluye mediante coverageStart. El motor registra pérdida de cobertura y aplica la regla de huecos. Dimensionar estas cotas para el feed real; no se ha probado carga productiva del NASDAQ 100 completo. Los scripts tienen trabajo acotado por la capacidad configurada, pero capacidades grandes pueden incrementar bloqueo de Redis.

## Cálculo y alertas

- Velas de un minuto calendario UTC; solo cerradas. Sin ticks no se fabrica una vela.
- Primer TR=high-low; siguientes=max(high-low, abs(high-closePrev), abs(low-closePrev)). Primer ATR=media de N TR (N=14 por defecto); después Wilder.
- Menos de N velas reales: `insufficientData`. ATR disponible sin M ATR anteriores: `baselineWarmingUp`. Con baseline completa: `ready`.
- Baseline=media de los M ATR anteriores, excluyendo el actual (M=20). Umbral inclusivo 1.5×, configurable. Una diferencia <=epsilon*max(abs(actual),abs(objetivo)) se considera igualdad; epsilon=1e-12 por defecto. Base cero/actual cero no alerta; positivo sobre base cero sí.
- Cooldown por símbolo y minuto de vela. No se pierde la fecha del evento al recuperar resultados históricos.
- Hasta K minutos faltantes conserva el cierre previo; más de K reinicia ATR, baseline y cooldown. K=5. El reset se aplica una vez por hueco, también al final de un ciclo sin ticks.
- Lecturas por símbolo independientes con timeout y reintento. Guardia de reentrada y reprogramación al próximo minuto evitan solapamiento y deriva. El estado de cada vela se confirma tras cálculo exitoso. Stop ignora respuestas pendientes.
- Estado incremental en memoria; tras reiniciar, se reconstruye desde la historia retenida en Redis. Ejecutar una sola instancia del scheduler por conjunto de símbolos; antes de escalar réplicas se necesita liderazgo/lock distribuido para evitar alertas duplicadas.

Configuración y defaults están en `.env.example`: ATR_SYMBOLS, ATR_PERIOD, ATR_THRESHOLD, ATR_BASELINE_WINDOW, ATR_MAX_GAP_MINUTES, ATR_COOLDOWN_MINUTES, ATR_EPSILON, ATR_READ_TIMEOUT_MS, TICK_RETENTION_MINUTES, TICK_MAX_PER_SYMBOL y TICK_KEY_PREFIX.

## Eventos para Flutter

Socket.IO usa el namespace `/telemetry`, no un WebSocket JSON convencional.

| Evento | Contenido |
| --- | --- |
| subscribe_symbol / unsubscribe_symbol | `{symbol:"NDX"}` |
| telemetry_tick | Tick con eventTime/receivedAt, timestamp ISO del mercado y emittedAt independiente |
| atr_result | symbol, minute, emittedAt, status, atr, baseline, alert |
| volatility_alert | El mismo resultado ATR que disparó la alerta |

El último ATR se entrega al suscribirse; la alerta no se reemite como una acción nueva al reconectar. Flutter resuscribe el símbolo activo, separa ticks/ATR y limpia los datos al cambiar de símbolo. `hedging_alert` sigue siendo un evento distinto: ATR no envía órdenes al broker ni define el trigger de caída porcentual.

## Verificación

```powershell
npm run lint
npm run build
npm test -- --runInBand
npm run test:integration
npm run smoke:local
```

La suite normal usa Jest fake timers y un gateway Socket.IO local. Los tests de Redis se omiten en `npm test` y se ejecutan explícitamente con `test:integration`. Esta segunda suite necesita Redis local; usa claves UUID exclusivas y elimina únicamente sus propias claves. Configurar REDIS_TEST_HOST, REDIS_TEST_PORT y REDIS_TEST_PASSWORD si difieren del Compose local. No apunta por defecto a una cuenta/proveedor externo.

`smoke:local` carga el AppModule real: necesita PostgreSQL y Redis del Compose, arranca un mock y un backend en puertos locales temporales, comprueba `/health`, `/atr` y Socket.IO, y los cierra al terminar. No envía órdenes ni notificaciones externas. Para incluir el cliente Dart real:

```powershell
$env:FLUTTER_EXECUTABLE = 'C:\flutter\bin\flutter.bat'
npm run smoke:local -- --flutter
```

Los reportes se escriben por defecto en `../reportes/atr_engine/` respecto a la raíz del repositorio (carpeta hermana del proyecto), nunca dentro de él. QA_REPORT_PATH y QA_SMOKE_REPORT_PATH permiten cambiar las rutas. CI los guarda en runner.temp y publica el artefacto streaming-metrics.

El escenario de carga genera 360 ticks, intervalo solicitado de 4 ms, tres cortes y replay con solapamiento. Registra tasa realmente lograda, p50/p95/máximo de recepción local→persistencia y recuperación hasta replay completo. Verifica <200 ms, <2 s, cero pérdida y unicidad de la ventana. Las pausas reales del sistema operativo afectan la tasa lograda; el reporte no presenta la tasa solicitada como throughput medido. Esta evidencia corresponde al simulador, no certifica el proveedor real.

La referencia pandas de 60 velas y 47 ATR se comparte desde `packages/atr_engine/test/fixtures/`; tolerancia absoluta <=1e-6. No se requiere Python para ejecutar los tests.
