# Plan de ingesta de precios de QQQ

> **Prueba real previa a producción, 5 de octubre de 2026:** resultado `NOT_READY`. QQQ: 17 precios recibidos, 17 rechazados como antiguos con límite de 2 s; ninguna entrega ni alerta. Reconexión en 930,64 ms. Los timestamps observados están alineados al minuto. Ver [evidencia completa](../reportes/market_data/twelve_data_live_2026-10-05.json) y el [informe actualizado](INFORME_MIGRACION_TWELVE_DATA.md).


> **Actualización posterior al merge (`93dee59`):** la recuperación Twelve Data inicia una ventana nueva tras cada corte, conserva los ticks persistidos en Redis y excluye el minuto parcial del ATR. Alpaca mantiene su recuperación REST. `recovery.continuity.recoveredThroughMs = 0` indica que Twelve Data no reproduce ticks históricos. Validación actual: 269 pruebas en 24 suites con Redis real, build y lint correctos. Los apartados anteriores de implementación y sus cifras históricas deben leerse junto con el [informe actualizado](INFORME_MIGRACION_TWELVE_DATA.md).


Guía de la implementación actual: [lógica de inversión, alertas y contratos de endpoints](LOGICA_INVERSION_ALERTAS_Y_ENDPOINTS.md).

## Proveedor actual: Twelve Data (5 de octubre de 2026)

La fuente activa se migró a Twelve Data por solicitud del usuario. El backend conecta a `wss://ws.twelvedata.com/v1/quotes/price`, autentica con `TWELVE_DATA_API_KEY` local y suscribe QQQ. Las secciones de entregas anteriores de este plan conservan evidencia del desarrollo con Alpaca; la configuración actual de este apartado tiene prioridad.

- Se conservan rutas HTTP, cuerpos de reglas, nombres de eventos, claves y tipos JSON; el frontend no se modifica.
- Los valores de origen pasan a `provider: "twelvedata"`, `feed: "realtime"` y `kind: "price"`. El mock usa `feed: "mock"`. `simulated` sigue siendo falso para datos reales y verdadero para mocks/test.
- `TwelveDataAdapter` entrega el contrato `MarketTick` existente al procesador y consumidor. El historial, factor ×2, señales, cruces y cooldown mantienen la lógica actual.
- El proveedor informa segundos Unix, sin ID ni volumen por operación. `eventTime` se convierte a ISO sin inventar precisión; `eventId` identifica la observación local; `volume: 0` indica que no está disponible; `conditions` queda vacío. No se confunde `day_volume` con el volumen de una operación.
- No se deduplican observaciones Twelve Data por hash de precio/segundo: A → B → A dentro de un segundo es un movimiento legítimo. Sin IDs externos no se garantiza deduplicación de retransmisiones del proveedor.
- El cliente envía heartbeat cada 10 s, espera la respuesta y degrada la conexión ante timeout. Se reutilizan reconexión y resuscripción. La URL autenticada y la clave nunca forman parte de los logs o respuestas.
- `.env` local contiene la clave proporcionada, está ignorado por Git y tiene permisos restringidos. `.env.example` conserva la clave vacía y el proveedor Twelve Data seleccionado. Si no se indica `MARKET_DATA_PROVIDER`, la fábrica selecciona `twelvedata`. Alpaca requiere selección explícita y no participa en el flujo de Twelve Data.

Configuración local de la nueva fuente:

```dotenv
MARKET_DATA_ENABLED=true
MARKET_DATA_PROVIDER=twelvedata
MARKET_DATA_FEED=realtime
MARKET_DATA_SYMBOL=QQQ
MARKET_DATA_WS_URL=wss://ws.twelvedata.com/v1/quotes/price
TWELVE_DATA_API_KEY=<clave-solo-en-env-local>
MARKET_DATA_HEARTBEAT_MS=10000
MARKET_DATA_HEARTBEAT_TIMEOUT_MS=10000
MARKET_DATA_MAX_TICK_AGE_MS=2000
```

`MARKET_DATA_MAX_TICK_AGE_MS` admite 2 s en la configuración Twelve Data por su precisión temporal de segundos; no es una promesa de latencia ni sustituye los controles de antigüedad. Los datos más antiguos se rechazan y no alimentan decisiones.

Desde `backend/`, `npm run start:dev` carga el `.env` local. Para comprobar solo conexión/suscripción: `node --env-file=../.env -r ts-node/register src/modules/market-data/testing/probe-market-data.ts`. Para pruebas locales: `npm run market-data:mock:twelve` y configurar provider `twelvedata`, feed `mock` y URL `ws://127.0.0.1:8765/v2/mock` en el backend.

Se añadió un mock Twelve Data y pruebas de normalización, errores, heartbeat, pérdida silenciosa y contrato público. La integración ejecuta el mismo escenario con Alpaca y Twelve Data y compara estructuras de reglas, historial, estado y eventos. La prueba inicial con la cuenta confirmó suscripción a QQQ y recepción de un evento `price`; la frescura se valida adicionalmente mediante el adaptador.

Fuente: [protocolo oficial de streaming Twelve Data](https://support.twelvedata.com/en/articles/5620516-how-to-stream-the-data). Contratos y uso: [guía de lógica y endpoints](LOGICA_INVERSION_ALERTAS_Y_ENDPOINTS.md).

### Verificación de la migración

Se aprobaron 178 pruebas en 14 suites, incluyendo los dos proveedores con los mismos contratos HTTP/Socket.IO y los nuevos casos de autenticación, normalización, heartbeat y reconexión. Se añadió y verificó además un caso de análisis que exige `simulated: false` para el feed real Twelve Data. Compilación correcta y lint sin errores (tres advertencias preexistentes).

La prueba externa del 5 de octubre de 2026 confirmó suscripción QQQ y mantuvo `LIVE` durante 25 s con heartbeat. El diagnóstico registró dos eventos con edades de **19.386 ms y 33.928 ms** respecto al reloj local. Ambos fueron rechazados como `stale` por el límite local de 2.000 ms: **esta prueba no acredita ingesta válida ni alertas con datos recientes**. Se solicitó al usuario definir si conserva ese límite o acepta hasta 60 s; mientras tanto se mantiene el filtro. No se sustituyen timestamps del proveedor por tiempos de recepción para hacer pasar datos antiguos como actuales.

## Historial del plan con Alpaca

La implementación original usó Alpaca Basic y su feed IEX para analizar variaciones y emitir alertas. Los apartados siguientes registran sus etapas y la evolución del análisis de inversión. Alpaca permanece como proveedor opcional para compatibilidad y pruebas, sin fallback automático desde Twelve Data.

La ingesta se ejecutará en **6 etapas**, cada una con un resultado verificable antes de avanzar. **Las etapas 1, 2 y 3 están implementadas y verificadas con mock local**. La etapa 3 incluye historial y reglas, y ahora incorpora el modelo de inversión ×2 del enunciado. También hay reconexión automática y métricas internas de latencia: son avances parciales de las etapas 4 y 5. La comprobación externa de la cuenta sigue pendiente de credenciales locales. Todo este trabajo queda limitado al backend; no se modifica el frontend.

## Propósito: análisis y alertas de precio

El flujo de producto implementado en el backend es **precios → validación → historial por intervalo → variación de la referencia → impacto estimado ×2 → señales y alertas configurables**. El canal Alpaca `trades` informa precios de operaciones que ya ocurrieron en el mercado; recibir esos mensajes no envía órdenes de compra o venta. `PriceAnalysisService` implementa `TickConsumer` y conecta la ingesta con el análisis.

Ejemplo ilustrativo: con precio de referencia 100, una regla de subida del 1 % se dispara al alcanzar 101 y una de bajada del 1 % al alcanzar 99. La variación se calcula como `((precio actual − precio de referencia) / precio de referencia) × 100`. No se crean reglas ni umbrales automáticamente al arrancar.

Decisiones confirmadas por el usuario:

- Comparar el precio actual con el precio de hace **un intervalo configurable**, por ejemplo 5 minutos. No fijar 5 minutos como requisito único.
- Mostrar las alertas en **la aplicación o dashboard conectado al backend**.

El consumidor mantiene un historial acotado de precios y timestamps del evento. Para cada tick válido en tiempo `t`, busca el último precio en o antes de `t − intervalo`, con una tolerancia máxima de referencia configurable (5.000 ms por defecto). Si no hay muestras suficientemente antiguas, devuelve `WARMING_UP`; si existe un hueco mayor que la tolerancia, devuelve `REFERENCE_GAP`. El análisis de precios obsoletos es `STALE` y no genera alertas.

Esta implementación usa umbrales porcentuales independientes de subida y bajada. Emite una alerta al entrar en la región de subida o bajada, incluso en igualdad con el umbral, y no repite avisos mientras se permanezca en esa región. Volver al rango neutral rearma el cruce; pasar directamente de subida a bajada también puede generar una alerta. Cada regla tiene un cooldown configurable. Un cruce suprimido por cooldown no genera un aviso tardío: exige un cruce nuevo.

Cada alerta identifica regla, símbolo, intervalo, referencia y su timestamp, precio actual, variación y umbral cruzado. Socket.IO entrega el evento `price_alert` a los clientes suscritos al símbolo; no hay persistencia ni replay de avisos. Las alertas de `mock` y `test` llevan `simulated: true`.

Las alertas usan datos válidos y recientes; una desconexión impide nuevas entregas y limpia el historial. Correcciones, cancelaciones, desbordamientos o fallos del consumidor también invalidan el análisis y emiten `market_data_quality`. Se espera una nueva ventana válida. Las alertas ya enviadas no se recalculan ni retractan; el evento de calidad informa de la invalidación. QQQ sigue identificado como referencia del Nasdaq 100, con cobertura IEX.

| Campo | Decisión |
| --- | --- |
| Sprint | Sprint 1 |
| Story points | 5 para la historia completa; las 6 etapas no equivalen a 6 puntos |
| Responsable | Backend Developer |
| Proveedor y plan | Alpaca Basic |
| Instrumento | QQQ como referencia del NASDAQ 100 |
| Fuente | IEX |
| Endpoint real | `wss://stream.data.alpaca.markets/v2/iex` |
| Canal | `trades` |
| Unidad del precio | USD |
| Objetivos | Procesamiento interno menor a 200 ms y recuperación menor a 2 s en la prueba definida |
| Fecha del plan | 4 de octubre de 2026 |

## Alcance y acceso al proveedor

[QQQ sigue el NASDAQ 100](https://www.invesco.com/qqq-etf/en/about.html). Sus precios son los de un ETF y deben identificarse como QQQ en cálculos y telemetría. Se reemplaza la selección anterior de LQQ para esta integración; no etiquetar estos datos como el valor oficial del índice NDX.

La [documentación de Alpaca Basic](https://docs.alpaca.markets/us/docs/about-market-data-api) indica acceso gratuito a acciones y ETFs estadounidenses, datos en tiempo real de IEX y hasta 30 símbolos por WebSocket. Para esta historia se usará un solo símbolo y una sola instancia de ingesta. Precio y volumen representan la actividad observada en IEX; no representan el mercado consolidado de todas las bolsas.

Se necesitan una cuenta Alpaca, su API key y secret, y acceso al feed IEX. Las claves se configurarán localmente en `.env`, sin publicarlas en el repositorio, logs ni chat. La recepción real de QQQ se verificará en una sesión activa. La integración de prototipo no presupone permisos para redistribuir datos a clientes; confirmar esos permisos antes de habilitar esa distribución.

Usar tres entornos identificados:

| Entorno | Función |
| --- | --- |
| Mock local con QQQ | Pruebas deterministas de validación, cola, fallos y tiempos controlados |
| Stream de prueba de Alpaca | Comprobar conectividad externa fuera del horario de mercado |
| IEX real con QQQ | Verificar suscripción, recepción de operaciones y antigüedad del dato |

El [stream de prueba](https://docs.alpaca.markets/us/docs/streaming-market-data) es `wss://stream.data.alpaca.markets/v2/test` y usa `FAKEPACA`. Requiere autenticación y debe habilitarse explícitamente. Sus mensajes deben identificarse como datos de prueba, sin alimentar decisiones de QQQ.

## Estado del backend y arquitectura

El proyecto usa NestJS 10, TypeScript, Jest, Redis con `ioredis` y Socket.IO para la app. La CI ejecuta Node.js 20. `MarketDataModule` integra cliente, procesador, historial, análisis y API de reglas; `HedgingModule` sigue vacío.

El nuevo flujo usa `broadcastMarketTick` y conserva `eventTime`/`eventTimeMs`, `receivedAtMs` y `emittedAtMs`. El campo compatible `timestamp` contiene el tiempo original del evento. Los métodos anteriores `TelemetryService.processIncomingTick` y `broadcastTick` siguen disponibles; aún generan sus propios timestamps y no se usan en este flujo. Redis no recibe el historial de la etapa 3.

```text
Alpaca IEX
  → cliente WebSocket y adaptador Alpaca
  → normalización y validación
  → cola acotada por instrumento
  → consumidor de análisis de variaciones
  → motor de reglas configurables
  → alertas para el usuario

Historial en memoria y telemetría Socket.IO; persistencia Redis pendiente.
```

Propuesta: cliente con `ws` como dependencia directa, puerto de consumidor `consume(tick): Promise<void>` y entregas secuenciales por instrumento. La resolución de la promesa significa aceptación del tick por el consumidor. La emisión al dispositivo y los cálculos completos de hedging tienen contratos propios.

Archivos nuevos propuestos en `src/modules/market-data/`:

- `market-data.config.ts`, `market-data.service.ts` y `market-data-ws.client.ts`.
- `adapters/alpaca.adapter.ts` y `dto/market-tick.dto.ts`.
- `ports/tick-consumer.interface.ts` y `consumers/telemetry-tick.consumer.ts`.
- `market-data-metrics.service.ts` y `market-data-status.controller.ts`.
- Fixtures y mock en `testing/`; pruebas `.spec.ts` junto al código.

Actualizar el módulo, `src/config/env.config.ts`, `src/main.ts`, telemetría, Redis cuando sea necesario, `../.env.example`, `package.json` y el lockfile. Mantener PostgreSQL fuera del camino crítico de cada tick.

## Contrato de datos

El adaptador interpretará el [esquema de operaciones de Alpaca](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data):

| Campo de Alpaca | Significado | Destino interno |
| --- | --- | --- |
| `T` | Tipo de mensaje; `t` para operación | `kind: 'trade'` |
| `S` | Símbolo | `symbol` y `providerSymbol` |
| `p` | Precio | `price` |
| `s` | Cantidad de la operación | `volume` |
| `t` | Tiempo RFC 3339 con precisión de nanosegundos | `eventTime` original y `eventTimeMs` derivado |
| `i` | Identificador de operación | `eventId` |
| `x` | Bolsa de ejecución | `exchange` |
| `c` | Condiciones de la operación | `conditions` |

Contrato propuesto:

```typescript
type MarketTick = {
  schemaVersion: 1;
  provider: 'alpaca';
  feed: 'iex' | 'test' | 'mock';
  symbol: string;
  providerSymbol: string;
  kind: 'trade';
  price: number;
  currency: 'USD';
  volume: number;
  eventId: string;
  exchange: string;
  conditions: string[];
  eventTime: string;
  eventTimeMs: number;
  receivedAtMs: number;
};
```

Conservar `eventTime` evita perder la precisión original al convertir a milisegundos. El tiempo monotónico usado para medir duraciones pertenece al contexto interno de procesamiento y no se serializa como timestamp UTC.

Validar explícitamente en el callback del cliente: formato del mensaje, símbolo configurado, precio finito positivo, volumen entero positivo, identificador representable sin pérdida, timestamp válido, bolsa y condiciones compatibles con el contrato. El `ValidationPipe` HTTP global no realiza esa validación automáticamente.

La política inicial de frescura será antigüedad máxima de 1.000 ms y tolerancia futura de 100 ms, con reloj sincronizado. Son valores propuestos para ajustar con evidencia del feed. Las operaciones antiguas se contabilizan y no habilitan decisiones actuales. La falta de operaciones nuevas en IEX no prueba que el socket esté desconectado.

Deduplicar con memoria acotada usando feed, símbolo, bolsa, fecha de sesión e identificador; no asumir que un trade ID sea una secuencia continua. No descartar dos operaciones distintas solo porque tengan igual precio y timestamp. Registrar desorden y evitar que una operación antigua retroceda el último estado de precio.

Alpaca también documenta correcciones y cancelaciones asociadas a operaciones. Tratarlas como eventos de control sobre el historial: no convertirlas en nuevos ticks. Si afectan datos utilizados por el consumidor, invalidar el estado correspondiente y emitir un evento de calidad; requerir reconciliación antes de volver a habilitar decisiones si el consumidor no puede aplicar la corrección.

## Configuración implementada en la etapa 1

| Variable | Valor o uso |
| --- | --- |
| `MARKET_DATA_ENABLED` | `false` por defecto |
| `MARKET_DATA_PROVIDER` | `alpaca` |
| `MARKET_DATA_FEED` | `iex`; `test` o `mock` solo en pruebas explícitas |
| `MARKET_DATA_WS_URL` | `wss://stream.data.alpaca.markets/v2/iex` |
| `MARKET_DATA_SYMBOL` | `QQQ`; `FAKEPACA` solo para el feed test |
| `ALPACA_API_KEY` | Clave local; vacía en el archivo de ejemplo |
| `ALPACA_API_SECRET` | Secreto local; vacío en el archivo de ejemplo |
| `MARKET_DATA_CONNECT_TIMEOUT_MS` | 10.000; límite de conexión y upgrade |
| `MARKET_DATA_AUTH_TIMEOUT_MS` | 5.000; máximo permitido 10.000 |
| `MARKET_DATA_SUBSCRIBE_TIMEOUT_MS` | 5.000; límite de confirmación de suscripción |
| `MARKET_DATA_CLOSE_TIMEOUT_MS` | 1.000; después se termina el socket |
| `MARKET_DATA_RECONNECT_BASE_MS` | 100 |
| `MARKET_DATA_RECONNECT_MAX_MS` | 5.000 |
| `MARKET_DATA_HEARTBEAT_MS` | Propuesta inicial de 15.000 para IEX |
| `MARKET_DATA_HEARTBEAT_TIMEOUT_MS` | Propuesta inicial de 10.000 para IEX |
| `MARKET_DATA_MAX_TICK_AGE_MS` | Propuesta inicial de 1.000 |
| `MARKET_DATA_QUEUE_CAPACITY` | Propuesta inicial de 1.000 |
| `MARKET_DATA_CONSUMER_TIMEOUT_MS` | Propuesta inicial de 100 |
| `MARKET_DATA_MOCK_PORT` | 8.765; solo el servidor CLI local |

Validar booleanos, URL, enteros positivos y coherencia entre feed, símbolo y endpoint al arrancar. Exigir credenciales solo para modos externos habilitados. Los valores de heartbeat son decisiones de implementación a verificar con el transporte, no límites publicados del proveedor.

### Entrega y ejecución de la etapa 1

- `market-data.config.ts`: configuración inmutable, deshabilitada por defecto, validada mediante `envConfig` y disponible por el token `MARKET_DATA_CONFIG`. IEX usa QQQ y test usa FAKEPACA. Los feeds externos requieren su URL exacta; mock solo permite WebSocket en loopback con puerto explícito y ruta `/v2/mock`. No se admiten credenciales en la URL, query o fragmento. Producción rechaza feeds de prueba habilitados.
- `dto/market-tick.dto.ts`: contrato TypeScript de ticks normalizados, conservando timestamp original, tiempo de recepción y cantidad por operación. La validación de mensajes entrantes se implementará en la etapa 3.
- `ports/tick-consumer.interface.ts`: puerto `consume(tick): Promise<void>` y token `TICK_CONSUMER`. El consumidor concreto se añadirá en las etapas siguientes.
- `testing/alpaca.fixtures.ts`: operaciones y lotes sintéticos reproducibles, incluyendo IDs distintos con igual precio y timestamp, y frames inválidos para probar el futuro adaptador.
- `testing/alpaca-mock.server.ts`: servidor local con autenticación, suscripción, desuscripción, lotes, errores seguros, una conexión simultánea, timeout de autenticación y ping/pong del transporte. Expone `publish`, `sendRawFrame`, `disconnectClients` y `stop` para pruebas controladas.
- `testing/run-alpaca-mock.ts`: CLI que emite una operación sintética cada 250 ms después de autenticar y suscribir; cierra sockets y temporizadores con SIGINT/SIGTERM.

Desde `backend/`, con Node.js 20:

```bash
npm ci
npm run market-data:mock
```

El mock escucha por defecto en `ws://127.0.0.1:8765/v2/mock`. Para otro puerto: `MARKET_DATA_MOCK_PORT=9000 npm run market-data:mock`. El CLI lee variables del proceso; no carga archivos `.env` ni necesita Redis, PostgreSQL o una cuenta Alpaca.

Un cliente de pruebas debe enviar estos comandos en orden, esperando cada confirmación:

```json
{"action":"auth","key":"mock-api-key","secret":"mock-api-secret"}
```

```json
{"action":"subscribe","trades":["QQQ"]}
```

Estas credenciales son ficticias y exclusivas del mock. Los fixtures conservan un timestamp fijo con nanosegundos; el CLI genera timestamps actuales. Todos sus precios son sintéticos.

Para conectar el cliente de la etapa 2 a este mock, configurar conjuntamente `MARKET_DATA_ENABLED=true`, `MARKET_DATA_FEED=mock`, `MARKET_DATA_SYMBOL=QQQ` y `MARKET_DATA_WS_URL=ws://127.0.0.1:8765/v2/mock`. La plantilla `../.env.example` mantiene `false` y las claves externas vacías.

Verificación realizada con Node.js 20.20.2:

- Instalación reproducible desde el lockfile con `npm ci --ignore-scripts --no-audit --no-fund --offline` usando la caché local de dependencias.
- `npm test -- --runInBand --ci`: 39 pruebas aprobadas en 4 suites, incluidas las pruebas existentes de salud. Las pruebas del mock usan sockets reales en loopback.
- El módulo Nest inicializa con ingesta deshabilitada y Redis sustituido por un doble de prueba; la fábrica global rechaza configuración inválida. No se ha probado el arranque completo contra PostgreSQL y Redis reales.
- `npm run lint`: sin errores; tres advertencias preexistentes por `any` en Redis y telemetría.
- `npm run build`: compilación correcta.

Al terminar la etapa 1, los objetivos de latencia y reconexión estaban pendientes: el mock permitía cortes pero el cliente no tenía recuperación automática. La actualización de negocio descrita más adelante incorpora recuperación y una primera prueba local de ambos límites.

### Entrega y ejecución de la etapa 2

- `market-data-ws.client.ts`: conexión JSON por `ws`, autenticación inmediata al abrir, suscripción después de `authenticated` y comprobación del símbolo en la confirmación. `start()` resuelve al confirmar la suscripción; llamadas concurrentes comparten una sesión.
- `market-data.connection.ts`: estados `DISABLED`, `CONNECTING`, `AUTHENTICATING`, `SUBSCRIBING`, `LIVE`, `DEGRADED`, `FAILED` y `STOPPED`, con errores de motivos permitidos. `LIVE` describe transporte y suscripción; todavía no certifica frescura ni habilita alertas.
- `alpaca.protocol.ts`: contrato de lotes crudos y credenciales ficticias compartidas con el mock. El cliente expone `data$` para el futuro adaptador, conserva el lote completo y agrega tiempos de recepción UTC y monotónico. Separa mensajes de control, operaciones, correcciones y cancelaciones.
- `market-data.service.ts`: inicia el cliente durante el bootstrap de Nest si está habilitado. Un fallo del feed conserva el estado del error y permite arrancar HTTP.
- `market-data.module.ts` exporta el cliente; `main.ts` habilita cierre por SIGINT/SIGTERM. El cliente cancela esperas, cierra el socket, fuerza su terminación si vence el plazo y libera listeners al cerrar. El apagado del módulo completa `data$`.
- `testing/probe-market-data.ts` y `market-data:probe`: prueba independiente de autenticación y suscripción, sin PostgreSQL ni Redis. Cierra la conexión al terminar; no mantiene ingesta continua ni analiza variaciones.

Los logs y `getStatus()` incluyen únicamente estado, proveedor, feed, símbolo, motivo seguro y códigos numéricos. No registran URL, credenciales, payloads, razón textual del cierre ni errores originales. Las redirecciones HTTP están deshabilitadas.

Clasificación inicial: errores Alpaca 400, 401, 402, 403, 405, 409 y 410 son permanentes (`FAILED`); 404, 406, 407 y 500 permiten recuperación futura (`DEGRADED`). Los errores desconocidos se tratan como permanentes. Los fallos de transporte, los tiempos vencidos y los rechazos HTTP 429/5xx son recuperables. En esta etapa no se programan reintentos automáticos.

Con el mock ejecutándose en otra terminal, desde `backend/`:

```bash
MARKET_DATA_ENABLED=true MARKET_DATA_FEED=mock MARKET_DATA_SYMBOL=QQQ MARKET_DATA_WS_URL=ws://127.0.0.1:8765/v2/mock npm run market-data:probe
```

Resultado esperado: `market_data_probe_ok`, estado `LIVE`, feed `mock` y símbolo `QQQ`, seguido del cierre. El comando lee variables del proceso; no carga `.env` automáticamente. Con Node.js 20 se puede cargar un archivo local usando `node --env-file=../.env -r ts-node/register src/modules/market-data/testing/probe-market-data.ts`.

Para la prueba externa, configurar en ese archivo local `MARKET_DATA_ENABLED=true`, `MARKET_DATA_FEED=test`, `MARKET_DATA_SYMBOL=FAKEPACA`, `MARKET_DATA_WS_URL=wss://stream.data.alpaca.markets/v2/test` y ambas claves Alpaca. Para IEX, cambiar conjuntamente feed a `iex`, símbolo a `QQQ` y URL al endpoint IEX. Una prueba externa correcta registra `LIVE` con el feed elegido. No publicar las claves en comandos compartidos ni en el repositorio.

Verificación de la etapa 2 con Node.js 20.20.2: **82 pruebas aprobadas en 6 suites**, compilación correcta y lint sin errores, con las tres advertencias preexistentes de Redis/telemetría. Se verifican autenticación, suscripción, lotes completos, FAKEPACA con transporte local, errores permanentes/transitorios, redacción de secretos, tiempos máximos, cierre durante conexión, cierre forzado y ciclo de vida Nest.

La prueba FAKEPACA de Jest redirige el transporte a un mock local con ese símbolo; no acredita acceso a una cuenta real. La prueba externa Alpaca sigue pendiente de credenciales. La etapa 3 añade validación, historial y alertas; la reconexión automática sigue pendiente de la etapa 4.

### Entrega y ejecución de la etapa 3

Implementado en `src/modules/market-data/`:

- `adapters/alpaca.adapter.ts`: validación de símbolo, precio, volumen, ID seguro, bolsa, condiciones, calendario RFC 3339, frescura y tolerancia futura. Conserva el timestamp original y usa nanosegundos internamente para detectar desorden.
- `market-data.processor.ts`: procesamiento de lotes completos, deduplicación acotada por feed/símbolo/bolsa/fecha UTC/ID, rechazo de desorden y cola secuencial con timeout. Una promesa vencida se aborta y no permite entregas concurrentes mientras siga pendiente. El consumidor asíncrono debe respetar `AbortSignal` antes de modificar estado o emitir.
- `analysis/price-history.ts`: buffer circular acotado y búsqueda de referencias por tiempo. Conserva los ticks completos validados. Los límites de capacidad pueden reducir la ventana disponible; se informa `evictedByCapacity` y no se inventa una referencia faltante.
- `analysis/price-analysis.service.ts`: consumidor que conserva el historial, evalúa reglas por porcentaje y publica ticks, alertas y eventos de calidad. El estado se modifica de forma síncrona, sin continuaciones tardías de entregas invalidadas.
- `dto/price-alert.dto.ts` y `market-data.controller.ts`: reglas validadas y endpoints de consulta/configuración. Se conserva el timestamp original hasta Socket.IO.

Configuración adicional en `../.env.example`:

| Variable | Valor por defecto y límite |
| --- | --- |
| `MARKET_DATA_FUTURE_TOLERANCE_MS` | 100 ms |
| `MARKET_DATA_DEDUP_CAPACITY` | 200.000 identidades; máximo 1.000.000 |
| `MARKET_DATA_HISTORY_RETENTION_MS` | 3.600.000 ms (1 h); de 1 s a 24 h |
| `MARKET_DATA_HISTORY_CAPACITY` | 100.000 ticks; de 2 a 1.000.000 |
| `MARKET_DATA_REFERENCE_TOLERANCE_MS` | 5.000 ms, limitada a la retención |
| `MARKET_DATA_MAX_ALERT_RULES` | 20; máximo 100 |

El intervalo de cada regla va de 1.000 ms hasta la retención configurada. Precio y condiciones son los de operaciones observadas en el feed; no se calculan cotizaciones consolidadas ni un precio oficial del índice. La deduplicación aplica dentro de la memoria disponible y no garantiza exactamente una vez entre reinicios o después de desalojar una identidad.

API del backend:

| Método y ruta | Función |
| --- | --- |
| `PUT /market-data/rules/:id` | Crear/reemplazar una regla; ID de 1–64 letras, números, guiones o guiones bajos |
| `GET /market-data/rules` | Reglas y análisis actual: `WARMING_UP`, `READY`, `REFERENCE_GAP`, `STALE`, `DISABLED` o `UNAVAILABLE` |
| `DELETE /market-data/rules/:id` | Eliminar la regla |
| `GET /market-data/history?limit=500` | Últimos ticks conservados y metadatos; límite de respuesta de 1 a 1.000 muestras |
| `GET /market-data/status` | Estado de conexión, contadores de ingesta, cola, historial y reglas |

Desde `backend/`, iniciar el mock en una terminal y el backend en otra (PostgreSQL y Redis requeridos por el arranque habitual del proyecto):

```bash
npm run market-data:mock
```

```bash
MARKET_DATA_ENABLED=true MARKET_DATA_FEED=mock MARKET_DATA_SYMBOL=QQQ MARKET_DATA_WS_URL=ws://127.0.0.1:8765/v2/mock npm run start:dev
```

Crear una regla de ejemplo con ventana de 5 minutos, subida de 1 %, bajada de 1 % y cooldown de 60 segundos:

```bash
curl -X PUT http://localhost:3000/market-data/rules/qqq-5m \
  -H 'Content-Type: application/json' \
  -d '{"windowMs":300000,"upPercent":1,"downPercent":1,"cooldownMs":60000,"enabled":true}'
```

No genera alertas hasta reunir la referencia necesaria. Los pequeños cambios de precio del CLI mock no garantizan cruzar un umbral del 1 %; las pruebas deterministas sí inyectan las subidas/bajadas necesarias. Configurar la regla con umbrales y ventana adecuados a la prueba. El comando `market-data:probe` de la etapa 2 solo comprueba conexión y suscripción, y no mantiene este historial.

El dashboard debe conectarse a Socket.IO en `/telemetry`, enviar `subscribe_symbol` con `{ "symbol": "QQQ" }` y escuchar `telemetry_tick`, `price_alert` y `market_data_quality`. Ejemplo de integración con un cliente Socket.IO disponible en el frontend:

```javascript
const socket = io('http://localhost:3000/telemetry');
socket.on('connect', () => socket.emit('subscribe_symbol', { symbol: 'QQQ' }));
socket.on('telemetry_tick', tick => console.log(tick.price, tick.eventTime));
socket.on('price_alert', alert => console.log(alert.direction, alert.changePercent));
socket.on('market_data_quality', quality => console.log(quality.reason));
```

La entrega backend está verificada con un cliente Socket.IO real sobre WebSocket. La pantalla Flutter existente usa NDX por defecto y todavía necesita seleccionar QQQ y presentar el nuevo evento de alertas; no se modificó la interfaz móvil en esta etapa de backend.

**Límites de la entrega inicial de etapa 3:** historial y reglas en memoria de una instancia; se pierden al reiniciar. No hay carga histórica al arrancar, persistencia Redis del historial/reglas ni entrega garantizada de avisos. La actualización de negocio posterior incorpora reconexión automática y una prueba de latencia local, sin completar la aceptación de carga de la etapa 6. Una regla de 5 minutos requiere reunir esa ventana después del arranque o de una invalidación. El historial anterior de ATR en Redis no tiene los timestamps necesarios para suplir esta ventana.

Verificación final de la etapa 3 con Node.js 20.20.2:

- `npm test -- --runInBand --ci`: **136 pruebas aprobadas en 11 suites**. Incluyen esquema, RFC 3339/nanosegundos, frescura al recibir y entregar, desorden, duplicados, cola, timeout, cancelación, buffer circular, referencias, ventanas, cruces, cooldown e invalidación.
- Integración por sockets reales **mock → Nest HTTP → historial/reglas → Socket.IO → alerta**, incluyendo consulta HTTP, validación de reglas y desconexión. PostgreSQL no participa y Redis está sustituido por un doble de prueba.
- `npm run lint`: sin errores; tres advertencias preexistentes por `any` en Redis/telemetría.
- `npm run build`: compilación correcta.
- `git diff --check`: sin errores de whitespace.

La sesión real con Alpaca y las mediciones de aceptación de latencia y reconexión no se ejecutaron en esta etapa.

## Cobertura del enunciado RiTech: inversión con exposición ×2

El backend calcula el modelo solicitado: si la referencia sube 2 %, la inversión estimada sube 4 %; si baja 2 %, la inversión estimada baja 4 %. Se conserva QQQ como referencia elegida por el usuario y se identifica como tal, sin publicar estos precios como el índice oficial NDX.

`HedgingModule` exporta `InvestmentAnalysisService`, utilizado por `PriceAnalysisService` en cada regla con una ventana válida. Las magnitudes son:

```text
variación de la referencia (%) = (precio actual / precio de referencia − 1) × 100
variación estimada de la inversión (%) = variación de la referencia × 2
ganancia/pérdida estimada (USD) = capital de referencia × variación de inversión / 100
valor estimado (USD) = capital de referencia + ganancia/pérdida estimada
```

Con capital de referencia de USD 10.000, +2 % produce +USD 400 y valor estimado USD 10.400; −2 % produce −USD 400 y valor estimado USD 9.600. Cada resultado compara el intervalo configurado: **no acumula resultados de ventanas solapadas, no representa una posición adquirida en una fecha de compra y no calcula el resultado contable de un ETF apalancado**. El contrato etiqueta el modelo como `SIMPLE_2X_PROXY` y el factor fijo como `leverage: 2`.

### Configuración de una inversión y sus alertas

Crear una regla por inversión/escenario, con ID distinto si se analizan varios capitales o intervalos:

```bash
curl -X PUT http://localhost:3000/market-data/rules/ritech-investment \
  -H 'Content-Type: application/json' \
  -d '{"windowMs":300000,"thresholdBasis":"INVESTMENT","investedAmount":10000,"upPercent":4,"downPercent":4,"cooldownMs":60000,"enabled":true}'
```

- `thresholdBasis: "INVESTMENT"`: compara el umbral con la variación estimada ×2. Un umbral de 4 % corresponde a un movimiento de referencia de 2 % en este modelo.
- `thresholdBasis: "REFERENCE"`: compara con la variación de QQQ. Es el valor por defecto para conservar el comportamiento de reglas anteriores.
- `investedAmount`: capital de referencia opcional en USD, entre 0,01 y 1.000.000.000.000. Si se omite, hay análisis porcentual pero `investedAmount`, `estimatedPnL` y `estimatedValue` son `null`; no se inventa un saldo.
- `upPercent` y `downPercent`: magnitudes positivas; la regla de bajada compara con el umbral negativo. `windowMs`, cooldown y habilitación mantienen las validaciones de etapa 3.

No se crean capitales ni reglas automáticas. Las reglas se mantienen en memoria. El modelo entrega señales para apoyar una decisión humana:

| Condición | `decision.signal` | Significado |
| --- | --- | --- |
| Variación evaluada ≥ umbral de subida | `REVIEW_GAIN` | Revisar la ganancia y evaluar una decisión sobre la inversión |
| Variación evaluada ≤ −umbral de bajada | `REVIEW_RISK` | Revisar la pérdida y evaluar el riesgo de la inversión |
| Dentro de ambos umbrales | `MONITOR` | Mantener el seguimiento |
| Historial insuficiente, hueco, precio antiguo, regla deshabilitada o cálculo inválido | Sin señal | No hay análisis vigente para tomar decisiones |

### Resultados HTTP y Socket.IO disponibles para el consumidor

`GET /market-data/rules` y `GET /market-data/status` incluyen `analysis.investment` y `analysis.decision` cuando el análisis está `READY`. `analysis.changePercent` sigue siendo la variación de QQQ; no cambia de significado.

En `/telemetry`, después de suscribirse al símbolo QQQ:

- `investment_update`: evaluación de cada regla en cada tick fresco, incluso en estado `WARMING_UP`. Con `READY` incluye `investment`, `decision` y `validUntilMs`, el instante a partir del cual el resultado se considera antiguo si no llega otra actualización.
- `price_alert`: conserva los campos anteriores y agrega `thresholdBasis`, `evaluatedChangePercent`, `investment` y `decision`. Mantiene cruces, rearme y cooldown; no emite repetidamente mientras se conserve la misma región.
- `market_data_quality`: invalida el análisis al perder conexión, ante correcciones o errores. Los consumidores deben retirar la señal vigente y esperar historial nuevo.
- `telemetry_tick`: tick normalizado con timestamp original. Los datos de `mock`/`test` se identifican como simulados en resultados y alertas.

El consumidor debe comprobar estado y vigencia antes de presentar una señal. Los eventos del backend son compatibles con el [protocolo Socket.IO](https://socket.io/docs/v4/socket-io-protocol/). **La pantalla Flutter no se modifica en esta entrega**; su conexión y visualización quedan para una tarea autorizada por separado. La entrega HTTP y Socket.IO sí está probada en el backend.

### Recuperación y mediciones incorporadas

`MarketDataService` programa un solo reintento para estados `DEGRADED`, con espera base configurable (100 ms por defecto), crecimiento exponencial y límite configurable (5.000 ms por defecto). Cada intento vuelve a autenticar y suscribir mediante el cliente existente. La espera se reinicia al recuperar `LIVE`. No reintenta errores permanentes `FAILED` y cancela el temporizador al apagar el módulo. Un corte limpia el historial y exige una nueva referencia válida; no hay replay de ticks perdidos.

`GET /market-data/status` entrega:

- `recovery.reconnectAttempts`, `recovery.reconnects`, `lastRecoveryDurationMs`, `reconnectScheduled` y `reconnecting`. La duración usa reloj monotónico desde `DEGRADED` hasta la nueva suscripción `LIVE`; la prueba también comprueba recepción posterior de un tick.
- `ingestion.receiptToConsumerLatencyMs`: contador, última muestra, máximo, promedio y p95 de las últimas 512 entregas exitosas; duración desde recepción hasta aceptación del consumidor, incluida la cola.
- `ingestion.lastEventAgeAtDeliveryMs`: edad del evento frente al reloj UTC al entregar, separada de la duración interna. Puede ser negativa dentro de la tolerancia futura; no se oculta.

Los logs de recuperación registran solo eventos y duraciones; no exponen configuración, claves ni errores originales.

La integración local prueba referencia 100 → 102 → 98, alertas +4 %/−4 % y resultados +USD 400/−USD 400. Exige alerta local y máximo interno menores a 200 ms, recuperación por corte controlado menor a 2 s, y nueva ingesta sin reutilizar historial anterior. Se añaden pruebas de reintentos, backoff, errores permanentes, apagado y medición monotónica.

**Verificación de esta actualización:** 147 pruebas aprobadas en 12 suites; compilación correcta; lint sin errores y tres advertencias preexistentes; `git diff --check` correcto. No hay cambios en `frontend_mobile/`.

**Límites de verificación:** esta prueba usa mock en loopback y Redis sustituido por un doble. No acredita red/proveedor reales, carga sostenida ni las 20 recuperaciones exigidas por etapa 6. El heartbeat para pérdidas silenciosas, la persistencia y la sesión real con claves Alpaca siguen pendientes. El motor ATR existente conserva su alcance independiente; este enunciado y las reglas confirmadas describen variación porcentual y exposición ×2, no una regla ATR específica.

## Las seis etapas de implementación

Cada etapa incluye sus pruebas y termina con un resumen de archivos modificados, resultado y pendientes. La etapa siguiente se construirá sobre verificaciones exitosas. Los logs deben proteger credenciales desde la primera conexión; la observabilidad no se posterga hasta el cierre.

| Etapa | Trabajo | Resultado para avanzar |
| --- | --- | --- |
| 1 — completada | Configuración tipada, DTO, contrato de consumidor, fixtures Alpaca y mock local | Módulo inicializado con ingesta deshabilitada, validación y protocolo del mock verificados; ver evidencia anterior |
| 2 — implementada; externa pendiente | Cliente `ws`, autenticación, suscripción `trades: ['QQQ']`, estados básicos y cierre limpio | Mock confirma autenticación, suscripción y ciclo de vida; errores seguros verificados. Falta prueba externa con claves |
| 3 — implementada con mock | Adaptador, validación, lotes, deduplicación, frescura, cola, historial por intervalo y reglas de alerta | Ticks elegibles alimentan el historial; cruce de umbral emite `price_alert` al cliente Socket.IO; invalidación reinicia la ventana |
| 4 — parcialmente implementada | Reintentos con espera creciente, reautenticación/resuscripción y cierre; ping/pong propio pendiente | Corte controlado recuperado en menos de 2 s en integración local; faltan pérdida silenciosa y 20 cortes |
| 5 — parcialmente implementada | Telemetría, impacto ×2, señales y métricas de latencia/recuperación; persistencia pendiente | API y eventos entregan referencia, inversión estimada y alertas; se conservan tiempos originales |
| 6 | Pruebas de carga, 20 cortes, redacción de secretos, CI y sesión real IEX con QQQ | Informe con evidencia de los cuatro criterios y límites de la prueba real |

Se puede completar la base de la etapa 1 sin claves. La comprobación externa de la etapa 2 y la sesión real de la etapa 6 necesitan credenciales locales. El stream de prueba permite trabajar fuera del horario activo; la aceptación con QQQ necesita actividad real de mercado.

### Detalles de conexión de la etapa 2

Seguir el [protocolo de WebSocket de Alpaca](https://docs.alpaca.markets/us/docs/streaming-market-data): enviar autenticación al conectar, dentro de 10 s, y esperar confirmación antes de suscribir. Verificar que la confirmación incluya el símbolo solicitado. Decodificar arrays completos y separar mensajes de control.

```json
{"action":"auth","key":"CLAVE_LOCAL","secret":"SECRETO_LOCAL"}
```

```json
{"action":"subscribe","trades":["QQQ"]}
```

Gestionar expresamente autenticación fallida, acceso insuficiente, exceso de conexiones y consumidor lento. Los errores permanentes pasan a estado fallido; los transitorios permiten recuperación. Respetar la conexión ya existente antes de abrir otra. El formato del mock debe reproducir el protocolo; FAKEPACA es un instrumento separado del test externo.

### Detalles de recuperación de la etapa 4

Estados propuestos: `DISABLED`, `CONNECTING`, `AUTHENTICATING`, `SUBSCRIBING`, `LIVE`, `RECONNECTING`, `DEGRADED`, `FAILED` y `STOPPED`. La conexión y la frescura son dimensiones separadas: fuera del horario activo puede haber socket disponible y ausencia de ticks actuales.

Ante cierre, fallo de transporte o heartbeat vencido, invalidar disponibilidad para nuevas decisiones, liberar la sesión anterior y programar un solo reintento. Propuesta: primera espera de 100 ms más jitter de 0 a 50 ms; siguientes esperas de 200, 400, 800 ms hasta 5.000 ms. Reiniciar intentos después de 30 s de estabilidad y respetar cualquier espera impuesta por el proveedor.

Reautenticar y resuscribir cada sesión. Invalidar callbacks antiguos y no duplicar timers ante eventos `error` y `close` consecutivos. No hay garantía de replay de operaciones perdidas ni de entrega exactamente una vez entre reinicios.

Habilitar hooks de cierre en NestJS para cancelar ping/pong, reconexiones y listeners. La detección de una pérdida silenciosa tiene el límite del heartbeat; el objetivo de 2 s corresponde a un cierre controlado con servidor disponible.

### Detalles de integración y métricas de la etapa 5

El consumidor real completará su promesa después de las operaciones necesarias de Redis y telemetría. Aplicar timeout y manejar errores; una promesa vencida no se considera cancelada ni permite que una sesión antigua vuelva a habilitar decisiones. Usar una cola limitada; si se llena, contabilizar pérdidas y marcar degradación. No lanzar una promesa ilimitada por tick.

Conservar timestamp del evento, recepción y emisión como campos distintos. La app deberá suscribirse a QQQ cuando se pruebe el flujo completo; su valor inicial NDX actual no debe etiquetar este feed. El cambio de selector móvil se coordinará en su propia etapa de integración.

La lista actual de precios en Redis no constituye por sí sola un cálculo ATR completo. Mantener los cálculos de estrategias y la ejecución de órdenes fuera de esta historia.

Registrar mensajes recibidos, ticks válidos, rechazados por motivo, duplicados, entregados, perdidos, desorden, errores y reconexiones. Medir profundidad de cola, tiempo del último tick, estado, latencias p50/p95/p99/máximo y duración de recuperación. Las muestras y etiquetas deben tener cardinalidad acotada.

Proponer `/health/market-data` como consulta separada de PostgreSQL y Redis, con feed, símbolo, estado, frescura y métricas agregadas. Registrar solo campos permitidos y motivos normalizados; excluir claves, headers, payload de autenticación y errores sin sanitizar.

## Pruebas y aceptación de la etapa 6

| Medida | Inicio y fin |
| --- | --- |
| Procesamiento interno | Callback de recepción → resolución del consumidor, incluyendo espera en cola |
| Edad evento a consumidor | Timestamp Alpaca → aceptación por el consumidor |
| Recuperación | Corte controlado del mock → aceptación del primer tick actual de la nueva sesión |

Usar reloj monotónico para duraciones internas y UTC para tiempos serializados. Conservar el timestamp original y documentar la precisión de su conversión. Edad negativa o falta de sincronización del reloj invalida la medida externa; no convertirla a cero. Ping/pong mide transporte, no ingesta.

Pruebas requeridas:

1. **Funcionales:** lotes, operaciones válidas, JSON inválido, tipos incorrectos, símbolo ajeno, volumen inválido, timestamps, control, duplicados, desorden, correcciones, consumidor lento, cola llena, Redis caído y apagado.
2. **Latencia:** mock y cliente en loopback con Node.js 20; 10 s de calentamiento, 60 s medidos a 100 ticks/s, un símbolo y 6.000 operaciones válidas con IDs únicos. Exigir entrega sin pérdidas ni duplicados y máximo interno estrictamente menor a 200 ms. Repetir con consumidor real y Redis local sano. Informar percentiles, máximo, equipo, revisión y versiones. Esta carga es propuesta de prueba, no una frecuencia garantizada de IEX.
3. **Reconexión:** 20 cierres controlados, dejando restablecer estabilidad entre ensayos. El mock permanece disponible y envía un tick actual después de autenticar y suscribir. Exigir todos los tiempos menores a 2.000 ms, una sesión y una suscripción activa. Probar por separado pérdida silenciosa, acceso inválido y servidor no disponible.
4. **Secretos:** inyectar valores centinela en headers, mensaje de autenticación, URL y errores; verificar ausencia en logs, métricas y estado, conservando evidencia de incidentes.
5. **IEX real:** sesión de al menos 10 min en horario activo con QQQ y reloj sincronizado. Verificar autenticación, suscripción y operaciones recibidas; informar procesamiento interno y edad del evento por separado. El máximo externo de 200 ms se evalúa si también se exige ese alcance. No extrapolar un resultado del mock a proveedor y red.
6. **CI:** ejecutar `npm ci`, `npm run lint`, `npm test -- --ci` y `npm run build`. Proponer un script `test:market-data:acceptance` para temporización real y Redis; todavía no existe.

Guardar un informe con ambiente, revisión, cantidades, tiempos, 20 recuperaciones y logs sanitizados. Si faltan credenciales o actividad real de QQQ, reportar la parte validada con mock/test y mantener pendiente la aceptación IEX. Completar la historia solo cuando estén demostrados los cuatro criterios.

El modelo simple de exposición ×2 y las señales configurables están incluidos. Quedan fuera la ejecución de órdenes, las estrategias adicionales de hedging y ATR, el valor oficial NDX, la cobertura consolidada SIP, el histórico durable, el replay y la coordinación de varias instancias de ingesta.
