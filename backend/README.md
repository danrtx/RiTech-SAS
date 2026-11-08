# Backend: ATR, caché y validación de streaming

## Gráfica diaria persistente

El módulo `market-chart` archiva los precios reales de **Twelve Data / QQQ** y las velas de un minuto en PostgreSQL. QQQ se identifica como ETF de referencia (`ETF_PROXY`); no se presenta como una cotización exacta de NDX. La gráfica Flutter ofrece línea, velas, agregación 5/15 minutos, volumen, zoom, cursor OHLC y consulta por fecha. El escenario ×2 es una comparación académica contra la apertura registrada de QQQ.

### Archivo y recuperación

- `market_chart_observations`: cada observación validada con ID local, precio, hora del proveedor, hora de recepción y fecha de Nueva York. Son observaciones de precios, no operaciones con ID de bolsa.
- `market_chart_candles`: OHLC por minuto, fecha, origen, volumen disponible, observaciones y revisión. Observación y actualización de vela se guardan en una transacción antes de emitir `chart_candle`.
- Se respetan el orden temporal, las observaciones que comparten segundo y los cambios de horario de Nueva York. Reintentar el mismo ID no duplica registros.
- Al arrancar y cada cinco minutos, una sola consulta REST `/time_series` recupera hasta 1.000 barras de un minuto, `timezone=UTC`, `exchange=NASDAQ`, `prepost=false`. No hay una consulta al proveedor por cada usuario. `CHART_HISTORY_ENABLED=false` desactiva esta recuperación, manteniendo el archivo del stream.
- Solo las barras ya cerradas y con OHLC válido sustituyen las velas muestreadas; un precio tardío no modifica los OHLC consolidados. El volumen del stream queda `null`: no se convierte el volumen acumulado del día en volumen por operación.
- Las fechas se asignan a `America/New_York`. El gráfico cubre la ventana regular habitual, lunes a viernes 09:30–16:00 ET. No inventa barras para minutos vacíos. El estado horario **no es un calendario oficial de festivos o cierres anticipados**.
- Las tablas no tienen TTL. El cierre no borra ni reinicia una jornada: queda consultable por fecha. Al reiniciar, se carga desde PostgreSQL, incluso si el proveedor está deshabilitado. La ventana REST de 1.000 barras no garantiza rellenar interrupciones arbitrariamente largas; la sesión más antigua recuperada puede ser parcial.
- El archivo admite observaciones demoradas hasta 24 horas para representar su instante original. Esto **no modifica** `MARKET_DATA_MAX_TICK_AGE_MS`, los descartes del consumidor operativo, ATR, reglas ni eventos existentes. Una gráfica con precios no acredita que los requisitos de latencia para decisiones se hayan satisfecho.
- La cola está acotada a 5.000 observaciones; ante errores se reintenta tres veces con el mismo ID, se contabiliza el descarte y se registra un error seguro. Los OHLC disponibles se reconcilian después por REST; no se reconstruyen ticks individuales inventados.

### Contratos nuevos

| Ruta/evento | Uso |
| --- | --- |
| `GET /market-data/chart` | Jornada más reciente guardada, o fecha actual si aún no hay datos. |
| `GET /market-data/chart?symbol=QQQ&date=2026-10-06` | Una jornada concreta; una fecha válida sin registros devuelve `candles: []`. |
| Socket.IO `/telemetry`, evento `chart_candle` | Vela de un minuto confirmada en PostgreSQL, enviada a la suscripción existente `subscribe_symbol: {symbol:"QQQ"}`. |

La respuesta HTTP incluye `symbol`, `provider`, `targetIndex`, `instrumentType`, `timeZone`, `interval`, `date`, `today`, `availableDates` (hasta 366 jornadas), `session`, `sessionTime`, `generatedAtMs`, `stream`, `storage`, `summary` y `candles`.

Cada vela contiene `symbol`, `date`, `startTimeMs`, `timeLabel` (ET), `open`, `high`, `low`, `close`, `volume`, `observations`, `source` (`stream`/`provider_ohlc`) y `updatedAtMs`. `summary` compara el último cierre disponible con la primera apertura registrada; puede ser una jornada parcial. Fechas inválidas/futuras y símbolos distintos de QQQ se rechazan con HTTP 400. Las jornadas más antiguas siguen disponibles por fecha explícita aunque no aparezcan en `availableDates`.

El frontend combina el snapshot HTTP con los eventos por minuto y revisión, consulta nuevamente cada 15 segundos y después de reconectar. Así obtiene también las correcciones REST y recupera eventos perdidos. Conserva la gráfica cargada ante una desconexión; las respuestas tardías de una fecha anterior no reemplazan la selección actual. `Conectado` describe la conexión al backend y `Precio reciente` requiere datos recientes; una sesión archivada se rotula `Histórico`.

Los formatos de `/market-data/status`, `/market-data/history`, `/market-data/rules`, `/atr` y sus eventos previos se conservan. No se crean reglas de alertas desde esta funcionalidad. Las claves de proveedor no llegan al navegador ni a los reportes.

### Migraciones y comprobación

TypeORM aplica automáticamente `MarketChartArchive1791345600000` al iniciar; `synchronize` queda desactivado también en desarrollo. La cuenta PostgreSQL usada por el backend necesita permisos para crear estas tablas y registrar la migración. El volumen Docker conserva los datos entre reinicios; no eliminarlo si se desea conservar las jornadas.

```bash
# Con PostgreSQL/Redis locales iniciados:
npm run lint
RUN_CHART_DB_TESTS=1 npm test -- --runInBand
npm run build
# Backend con datos reales, durante una sesión con publicaciones:
npm run chart:probe -- --require-live
```

La prueba PostgreSQL usa un esquema temporal exclusivo que elimina al finalizar; no borra datos del archivo operativo. Comprueba transacciones, idempotencia, OHLC fuera de orden, recuperación al reconectar y consolidación histórica. CI ejecuta estas pruebas en PostgreSQL 16 y también compila Flutter Web.

`chart:probe` solo lee: consulta la gráfica, comprueba una jornada anterior y confirma que un evento WebSocket ya existe en PostgreSQL. Fuera de horario, omitir `--require-live` para permitir que no se observe un evento nuevo durante los 30 segundos de prueba. `CHART_PROBE_URL` permite otra URL base; `CHART_ARCHIVE_URL` permite contrastar con otra instancia del mismo archivo, iniciada con `MARKET_DATA_ENABLED=false`, `CHART_HISTORY_ENABLED=false` y un prefijo Redis aislado. `--output=ruta.json` guarda evidencia sin credenciales.

El 7 de octubre de 2026 se verificaron 293 velas del día, 390 de la jornada anterior, un evento real ya persistido, y lectura idéntica desde una segunda instancia sin proveedor activo. La prueba de navegador verificó línea/5m, zoom, historial, conservación ante fallo HTTP y diseños 1440×1200 y 390×980. Reportes en `../reportes/market_data/chart_*_2026-10-07.*`. La compilación web JavaScript funciona; Flutter avisa que la dependencia existente `socket_io_common` no supera su comprobación opcional de WebAssembly.

Documentación del proveedor: [time series de Twelve Data](https://twelvedata.com/docs#time-series) y [zonas horarias](https://support.twelvedata.com/en/articles/5745849-timezones).

## Enunciado RiTech: variación del índice ×2

El modelo académico `SIMPLE_2X` calcula variación de la inversión = variación de la referencia ×2, sin acumular ventanas ni simular una orden al broker. Los endpoints y eventos incluyen `marketReference`: QQQ se declara `ETF_PROXY`, `matchesRequiredIndex:false`; no es NDX. Los datos del mock llevan `simulated:true`. El feed QQQ no proporciona la cotización exacta del índice exigido por el enunciado.

Las reglas admiten dos referencias explícitas:

- `WINDOW` (compatible con las reglas existentes): `windowMs` obligatorio; mide el cambio en esa ventana.
- `ENTRY`: `entryPrice`, `entryTimeMs` (Unix ms, no futuro) e `investedAmount` obligatorios; omitir `windowMs`. Calcula siempre contra esa entrada, incluso cuando la ventana en memoria ya no la conserva. Precio y fecha deben corresponder al mismo instrumento que el feed. La API recibe esa referencia del usuario; no acredita una compra real.

Ejemplo de cuerpo para `PUT /market-data/rules/inversion-ritech` (usar fecha real de la referencia; el precio es ilustrativo):

```json
{
  "referenceMode": "ENTRY",
  "entryPrice": 20000,
  "entryTimeMs": 1790946000000,
  "investedAmount": 10000,
  "thresholdBasis": "INVESTMENT",
  "upPercent": 4,
  "downPercent": 4,
  "cooldownMs": 60000,
  "enabled": true
}
```

Con referencia 20000, un valor 20400 da +2% en la referencia, +4% en la inversión y valor estimado 10400; con 19600 da -2%, -4% y 9600. `referenceMode`, `referencePrice` y `referenceTimeMs` identifican la base del cálculo. `investment_update` y `price_alert` conservan las señales de revisión de ganancia/riesgo. El capital no se actualiza con cada tick. No hay capitalización diaria, comisiones ni contabilidad de posiciones; el saldo puede ser negativo si así resulta de la fórmula académica.

Las reglas siguen en memoria: se conservan durante reconexiones, pero deben cargarse otra vez después de reiniciar el backend. Su gestión continúa por API; el nuevo dashboard de gráficas no crea reglas ni simula una posición de inversión.

### Consulta del índice NDX real por cierre diario

`GET /market-data/index/history?from=2026-09-28&to=2026-09-29` consulta cierres reales mediante el [REST de índices de Massive](https://massive.com/docs/rest/indices/aggregates/custom-bars), símbolo `I:NDX`. Requiere una cuenta con acceso al conjunto de datos y `MASSIVE_API_KEY` configurada exclusivamente en el backend. La clave se envía en el encabezado Authorization al destino oficial, sin redirecciones. No se crean cuentas, no se contratan planes y no se consulta al proveedor al arrancar: solo al invocar estos endpoints.

Configurar la variable en el entorno del proceso del backend o en su archivo de configuración local no versionado. No pegarla en el frontend, el repositorio ni un reporte. Se puede probar esta ruta con MARKET_DATA_ENABLED=false y sin activar Alpaca.

`POST /market-data/index/evaluate` consulta los cierres de entrada y valoración y aplica el modelo ×2:

```json
{
  "entryDate": "2026-09-28",
  "valuationDate": "2026-09-29",
  "investedAmount": 10000,
  "upPercent": 4,
  "downPercent": 4
}
```

Las fechas son sesiones de mercado en America/New_York. Se rechazan días actuales/futuros, intervalos superiores a 366 fechas, fechas sin cierre, respuestas de otro instrumento y OHLC inválidos. No se sustituye un fin de semana por otra fecha. El resultado declara `dataMode:HISTORICAL_DAILY_CLOSE`, `simulated:false`, `sourceSymbol:I:NDX`, la fecha de cada cierre y el instante de consulta. No se envían estos cierres al flujo de ticks ni al ATR de un minuto: eso inventaría resolución intradía. Sin clave devuelve 503 `ndx_credentials_missing`; sin permisos o ante límites, un error controlado del proveedor, nunca datos sintéticos de respaldo.

Esta ruta permite analizar el enunciado con datos reales, pero **no satisface por sí sola el requisito WebSocket en tiempo real de ClickUp**. Las pruebas de contrato usan respuestas simuladas; falta verificar la cuenta y una consulta real. Las pruebas anteriores del conector QQQ no certifican esta fuente NDX. Una UI puede consumir estos endpoints sin mezclar su historial con QQQ.

Twelve Data fue revisado el 5 de octubre de 2026: su catálogo público `symbol_search?symbol=NDX` devuelve Nordex SE (ADR alemán) para el símbolo exacto, y su página de índices muestra “Indices coming soon”. No se configuró NDX con ese proveedor ni se presupuso acceso gratuito o retraso de 15 minutos. Cualquier alternativa debe acreditar identidad del instrumento y permisos antes de conectarla.

El cálculo operativo vive en `src/modules/atr/` y se conecta al servicio Redis y a la telemetría NestJS. El paquete `../packages/atr_engine` conserva la implementación Dart y la referencia externa compartida para comprobar paridad. Flutter consume resultados del backend; no necesita calcular el ATR operativo en el teléfono.

## Épica 01: conector de mercado integrado

El flujo operativo principal es Twelve Data → MarketDataProcessor → MarketAtrConsumer → Redis → PriceAnalysisService/Socket.IO, más el scheduler ATR cada minuto. El archivo PostgreSQL de gráficas sigue la ruta independiente descrita arriba. Alpaca es un proveedor opcional seleccionado explícitamente. Se preservan eventTimeMs y receivedAtMs del conector; el ID Redis es un hash de proveedor, feed, símbolo, bolsa, fecha UTC e identificador de observación/operación. No se publica dos veces el tick. Redis admite la tolerancia futura configurada del conector sin cambiar la fecha del proveedor.

Los eventos de inversión y sus endpoints siguen el contrato de Dylan: price_alert mide cruce porcentual e investment_update presenta el modelo ×2. volatility_alert corresponde exclusivamente al ATR; las dos señales no se sustituyen entre sí.

Para probar específicamente la compatibilidad con el mock de Alpaca, arrancar Docker Compose y abrir dos terminales en backend. Primera:

```powershell
npm run market-data:mock
```

Segunda:

```powershell
$env:MOCK_FEED_URL = ''
$env:MARKET_DATA_ENABLED = 'true'
$env:MARKET_DATA_PROVIDER = 'alpaca'
$env:MARKET_DATA_FEED = 'mock'
$env:MARKET_DATA_SYMBOL = 'QQQ'
$env:MARKET_DATA_WS_URL = 'ws://127.0.0.1:8765/v2/mock'
$env:ATR_SYMBOLS = 'QQQ'
$env:TICK_KEY_PREFIX = 'ritech:demo:alpaca'
npm run start:dev
```

Consultar /market-data/status, /market-data/history y /atr. Flutter selecciona QQQ por defecto; MARKET_SYMBOL permite otro símbolo con dart-define. QQQ es una referencia del Nasdaq 100, no se renombra a NDX. El motor necesita 14 velas completas para ATR y 20 ATR anteriores para baseline: aproximadamente 34–35 minutos desde el arranque sin historial, con estos defaults. La paridad numérica se prueba automáticamente con reloj controlado, sin esperar ese tiempo.

El heartbeat de Alpaca utiliza ping/pong (500 ms de intervalo y 500 ms de plazo por defecto); Twelve Data utiliza su acción `heartbeat` (10 s de intervalo y plazo por defecto). No dependen de que el mercado produzca operaciones. Detectan una ruta silenciosa y activan la reconexión con autenticación/suscripción. Los tiempos bajo proveedor real siguen sujetos a red y disponibilidad.

**Recuperación histórica de Alpaca:** al iniciar o reconectar, MarketRecoveryService pausa el análisis y conserva la ventana existente. Consulta el historial desde el último tick persistido, con solapamiento inclusivo, pagina y combina el resultado con los ticks que siguen llegando por WebSocket. Redis deduplica y permite reparar minutos sellados exclusivamente durante esta recuperación. Después se reconstruyen la ventana de precios y ATR antes de habilitar nuevas señales. Los ticks y alertas históricos no se publican como eventos nuevos. No se garantiza entrega exactamente una vez de todos los eventos al teléfono: la continuidad verificada corresponde a la ventana del backend.

**Twelve Data:** no ofrece replay exacto de estas observaciones. La reconexión reinicia la cobertura del análisis/ATR desde una nueva frontera de minuto; las barras REST se utilizan para el archivo de gráficas y no se convierten en ticks para el motor de decisiones.

El feed IEX usa [Historical trades de Alpaca](https://docs.alpaca.markets/us/reference/stocktrades-1), con las credenciales configuradas y el mismo feed del socket. El mock local sirve ese contrato REST en el mismo puerto del WebSocket. La integración está validada localmente; faltan pruebas con los permisos, disponibilidad y latencia de una cuenta real. No combinar el mock antiguo (`mock:feed`) con MARKET_DATA_ENABLED=true.

`GET /market-data/status` incluye `continuity.state`, `lastError`, `bufferDepth`, `recoveries` y `lastDurationMs`. Una conexión WebSocket LIVE por sí sola no implica análisis disponible. Errores REST, historial sin el checkpoint esperado, timeout o exceso de capacidad mantienen el análisis pausado y reintentan. Correcciones/cancelaciones bloquean con `recovery_requires_corrected_history`: requieren reconciliar los datos corregidos antes de reanudar; el sistema no calcula sobre precios conocidos como inválidos. El primer arranque sin historial excluye su minuto parcial.

Defaults: MARKET_DATA_RECOVERY_TIMEOUT_MS=10000, MARKET_DATA_RECOVERY_MAX_TICKS=100000, MARKET_DATA_RECOVERY_MAX_GAP_MS=3600000 y MARKET_DATA_HISTORY_PAGE_SIZE=1000. Una interrupción superior al máximo o a la retención exige intervención y una fuente con cobertura suficiente. El feed de prueba de Alpaca (`test`) no proporciona este historial y no permite completar la recuperación. Ejecutar una instancia coordinadora por conjunto de claves.

## QA asignada a Diego

```powershell
npm run qa:epic01
# Verificar todos los criterios, incluida continuidad (modo usado en CI):
npm run qa:epic01 -- --strict-continuity
```

El comando usa los módulos reales NestJS, Redis local con claves UUID, HTTP, Socket.IO y mock del protocolo Alpaca. Genera carga durante 30 s (20 ticks por lote cada 50 ms), tres cortes visibles y una ruta silenciosa; mide latencia y recuperación e inyecta duplicados. Solo elimina sus propias claves y guarda ../reportes/epic01/qa_metrics.json fuera del repositorio. QA_DURATION_MS (10000–300000), QA_BATCH_SIZE (1–100), QA_INTERVAL_MS (20–1000) y QA_EPIC01_REPORT_PATH permiten ajustar el escenario.

El modo strict-continuity falla si se pierde algún tick generado o si la ventana final del análisis no coincide con la persistida. CI exige este modo. La recuperación se mide hasta completar el historial y habilitar el análisis, no solo hasta reconectar el socket. El reporte contiene tasa realmente lograda, máximo/promedio de toda la ejecución y p95 de las últimas 512 entregas. Se mide recepción en backend → consumidor, no mercado → teléfono. Esta validación sintética no sustituye la aceptación con una cuenta real.

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

Scripts Lua hacen atómicos deduplicación, inserción, poda y snapshots. Para datos Alpaca, la precisión original del timestamp y el ID desempatan ticks del mismo milisegundo; datos sin `source` conservan el orden de recepción. El JSON original preserva los doubles. El snapshot de `[from,until)` sella los minutos anteriores a until; en modo vivo se rechazan ticks tardíos. El coordinador permite rellenarlos en recuperación y reconstruye el cálculo sin alertas retrospectivas. `source` conserva el evento normalizado para restaurar la ventana tras reiniciar el proceso. No se usa SCAN ni KEYS para leer la ventana.

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
