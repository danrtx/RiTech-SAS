# Informe de implementación: migración de ingesta a Twelve Data

**Proyecto:** RiTech SAS  
**Fecha:** 5 de octubre de 2026  
**Alcance:** backend, configuración de ingesta y pruebas.  
**Referencia:** migración original `3340707`, integrada en `feature/real-time_ws` mediante `93dee59`; correcciones posteriores del merge y recuperación incluidas en el árbol de trabajo.

## 1. Resultado de la implementación

Se incorporó Twelve Data como fuente WebSocket de precios de **QQQ**, conservando el historial, las reglas de subida/bajada, el cálculo de impacto estimado ×2 y los canales de entrega al dashboard.

QQQ continúa siendo una referencia del comportamiento del Nasdaq 100. Esta migración no cambia el instrumento a LQQ ni obtiene directamente el índice oficial NDX.

Se mantuvieron las rutas, los campos y la estructura de los JSON públicos de la rama integrada, incluidos sus metadatos de referencia de mercado. Se ampliaron los valores admitidos para identificar el nuevo proveedor y sus eventos de precio. **El frontend no se modificó. Alpaca tampoco se eliminó: permanece como proveedor opcional.**

La integración está implementada y verificada con ambos proveedores simulados y Redis real: **269 pruebas aprobadas en 24 suites, compilación y lint sin errores**. **La nueva prueba externa no superó la aceptación:** 17 precios recibidos y 17 rechazados por antigüedad según el timestamp del proveedor; no hubo entregas ni alertas. La reconexión sí cumplió el límite de 2 segundos. Ver sección 9.

## 2. Recuperación corregida después del merge

Se resolvieron las propiedades duplicadas de configuración, las dos implementaciones de limpieza del heartbeat, el import faltante de `MarketDataProvider` y los bloques mezclados de la prueba de integración. La limpieza de conexión cancela tanto el heartbeat de aplicación Twelve Data como el ping/pong Alpaca.

La recuperación depende del proveedor:

| Proveedor | Arranque y reconexión |
| --- | --- |
| Alpaca | Conserva recuperación REST de operaciones, checkpoint y combinación con los mensajes recibidos durante la consulta. |
| Twelve Data | Establece una nueva ventana de observaciones; no consulta Alpaca ni transforma velas históricas en ticks individuales. |

En Twelve Data, al perder continuidad se pausa el análisis, se vacía su ventana activa y se invalida el ATR. Tras confirmar la nueva suscripción, se guarda en Redis una frontera de cobertura al siguiente minuto completo y se habilita la entrega. Los mensajes recibidos mientras se prepara esa frontera se almacenan en un buffer acotado y atraviesan después la validación de frescura habitual. Un fallo de Redis mantiene bloqueada la entrega y activa reintentos; una desconexión o cancelación impide reanudar trabajo de una sesión anterior.

Los ticks persistidos permanecen en Redis hasta su expiración o expulsión habitual; no se restauran como una ventana continua de Twelve Data después de un corte. El ATR vuelve a calentarse con minutos completos posteriores a la frontera. Las reglas `WINDOW` reúnen de nuevo su intervalo; las reglas `ENTRY` conservan el precio de entrada configurado y pueden evaluar un nuevo precio válido.

Se mantienen las claves y tipos JSON. Para Twelve Data, `recovery.continuity.recoveredThroughMs: 0` significa **sin reproducción histórica de ticks**, y `historicalTicks: 0` confirma que no se incorporó tal historial. `state: LIVE` indica entrega habilitada; no garantiza que las reglas o el ATR ya tengan suficientes muestras. Los metadatos `simulated` y `marketReference.simulated` coinciden para el feed real.

Redis conserva el orden de llegada mediante su secuencia interna cuando varios precios tienen el mismo timestamp. Esto evita reordenar por UUID movimientos como 100 → 102 → 100 y alterar apertura/cierre del ATR.

### Flujo de información actual

```text
Twelve Data: precios de QQQ
        ↓
MarketDataWsClient: conexión, suscripción y heartbeat
        ↓
MarketRecoveryService: preparar nueva ventana y frontera ATR
        ↓
TwelveDataAdapter / MarketDataProcessor: validación, cola y métricas
        ↓
MarketAtrConsumer: persistencia en Redis antes de analizar
        ↓
PriceAnalysisService: historial, variación, impacto ×2 y reglas
        ↓
API HTTP / Socket.IO: consultas, actualizaciones y alertas
```

El adaptador y protocolo Twelve Data conservan la implementación original de `dylan` (`3340707`). Por decisión del usuario, se mantiene el ATR incorporado después y se alimenta con esos precios; no se restaura el recorrido anterior sin ATR. La selección del adaptador depende de `MARKET_DATA_PROVIDER`. No se implementó un cambio automático a Alpaca cuando Twelve Data falla.

## 3. Qué se mantuvo

| Componente | Comportamiento conservado |
| --- | --- |
| Instrumento de análisis | QQQ, con precios en USD, como referencia del Nasdaq 100. |
| Historial | Muestras válidas en memoria; comparación contra el precio de hace un intervalo configurable. |
| Reglas | Ventana, umbrales de subida/bajada, habilitación, cooldown y selección de base de comparación: referencia o inversión. |
| Modelo de inversión | Impacto estimado igual al doble de la variación de la referencia. |
| Capital opcional | Estimación de ganancia/pérdida monetaria y valor resultante cuando se informa capital invertido. |
| Alertas | Detección de cruces de umbral y control de repeticiones mediante estado y cooldown. |
| Calidad del análisis | Estados de calentamiento, disponibilidad y frescura; invalidación ante interrupciones o fallos de integridad. |
| Procesamiento | Cola acotada, control de antigüedad y orden, infraestructura de deduplicación y entrega al consumidor. |
| Recuperación | Servicio existente de reconexión con reintentos y nueva suscripción. |
| Observabilidad | Estado de conexión, contadores de ingesta, rechazos, latencia interna y recuperación. |
| API y dashboard | Rutas HTTP, nombres de eventos Socket.IO y estructura de los objetos enviados. |
| Proveedor anterior | Adaptador, protocolo, mock y configuración opcional de Alpaca. |

Las fórmulas de negocio siguen siendo:

```text
variaciónReferencia (%) = ((precioActual - precioAnterior) / precioAnterior) × 100
impactoInversión (%) = variaciónReferencia × 2
gananciaOPérdidaEstimada = capitalInvertido × impactoInversión / 100
valorEstimado = capitalInvertido + gananciaOPérdidaEstimada
```

Ejemplo: si QQQ pasa de 100 a 102 en la ventana evaluada, la referencia sube 2 % y el modelo estima +4 %. Con un capital de 10.000 USD, representa +400 USD. Es una estimación por ventana; no constituye una operación ejecutada ni un registro de rentabilidad real de LQQ.

## 4. Qué cambió

| Aspecto | Implementación anterior | Implementación con Twelve Data |
| --- | --- | --- |
| Fuente seleccionada en el entorno local | Alpaca | Twelve Data, feed `realtime`. |
| Endpoint externo | WebSocket de Alpaca, feed IEX | `wss://ws.twelvedata.com/v1/quotes/price`. |
| Credenciales | API key y API secret | `TWELVE_DATA_API_KEY`; se incorpora a la URL únicamente al abrir la conexión. |
| Suscripción | Canal de operaciones de Alpaca | Acción `subscribe` con `params.symbols: "QQQ"`. |
| Mensajes recibidos | Lotes de mensajes de operaciones | Eventos individuales `price`, confirmaciones de suscripción y heartbeat. |
| Normalización | Adaptador Alpaca | Adaptador seleccionado mediante la interfaz común `MarketDataAdapter`. |
| Tiempo del proveedor | Timestamp de operación de Alpaca | Timestamp Unix en segundos, convertido a milisegundos e ISO sin inventar precisión adicional. |
| Supervisión | Gestión existente de conexión | Se añade heartbeat de aplicación para Twelve Data y fallo recuperable si no responde. |
| Clasificación de simulación | Todo feed distinto de `iex` era simulado | Solo `mock` y `test` se consideran simulados; `realtime` produce `simulated: false`. |
| Pruebas | Escenarios Alpaca | Escenarios para ambos proveedores y comparación de contratos públicos. |

El nuevo adaptador valida tipo de mensaje, símbolo, moneda, precio positivo y finito, bolsa, timestamp, antigüedad y tolerancia a fechas futuras. Los mensajes rechazados no alimentan los cálculos.

### Diferencias de contenido dentro del mismo JSON

Conservar la estructura no significa conservar todos los valores ni su significado:

| Campo de `MarketTick` | Valor o significado en Twelve Data |
| --- | --- |
| `schemaVersion` | Se mantiene en `1`. |
| `provider` | `"twelvedata"`. |
| `feed` | `"realtime"` en conexión externa; `"mock"` en pruebas locales. |
| `kind` | `"price"`, porque el evento informa un precio sin identificar una operación individual. |
| `eventId` | Identificador local nuevo con prefijo `td:`; no es un ID de operación de bolsa. |
| `volume` | `0`: volumen por operación no disponible. El volumen diario del proveedor no se transforma en volumen de una operación. |
| `conditions` | Arreglo vacío: ese dato no está disponible en el evento utilizado. |
| `exchange` | Bolsa informada por Twelve Data. |
| `eventTime` / `eventTimeMs` | Instante original del proveedor, expresado en ISO y milisegundos. |
| `receivedAtMs` | Instante local de recepción, separado del tiempo del proveedor. |

Los clientes que validen valores literales de `provider`, `feed` o `kind` deben admitir los nuevos valores. La comparación de contratos verifica claves y tipos, no que todo el contenido sea idéntico.

Cada observación recibe un ID nuevo para conservar movimientos A → B → A dentro del mismo segundo. La infraestructura de deduplicación permanece, pero este feed no permite garantizar deduplicación de retransmisiones mediante un ID original de operación.

## 5. Qué se eliminó o reemplazó realmente

**No se eliminaron archivos, endpoints ni funcionalidades de negocio en el cambio de código revisado.** Las eliminaciones de líneas corresponden a reemplazos internos y reorganización de pruebas.

| Elemento retirado o reemplazado | Sustitución |
| --- | --- |
| Dependencia directa de `MarketDataProcessor` respecto de `AlpacaAdapter` | Inyección de `MARKET_DATA_ADAPTER`, seleccionada según el proveedor. |
| Definición independiente de `AlpacaDataBatch` | Tipo compartido `MarketDataBatch`; el nombre anterior se conserva como alias de compatibilidad. |
| Restricción de configuración que admitía únicamente Alpaca | Validación de proveedor, feed y credenciales para Alpaca o Twelve Data. |
| Suposición de que todo feed distinto de IEX era simulado | Comprobación explícita de `mock` y `test`. |

En la ruta Twelve Data ya no se utiliza la autenticación de Alpaca con key/secret ni su comando de suscripción a operaciones. Ambos siguen disponibles cuando se selecciona Alpaca.

No se retiraron los controles de frescura, el historial, las reglas, los cálculos ×2 ni las alertas. Tampoco se sustituyó el timestamp del proveedor por la hora local para aceptar datos antiguos.

## 6. Endpoints y eventos conservados

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/market-data/status` | Consultar conexión, ingesta, recuperación y análisis. |
| `GET` | `/market-data/history?limit=500` | Consultar las muestras disponibles del historial. |
| `GET` | `/market-data/rules` | Consultar reglas y su análisis. |
| `PUT` | `/market-data/rules/:id` | Crear o reemplazar una regla. |
| `DELETE` | `/market-data/rules/:id` | Eliminar una regla. |

Socket.IO conserva el namespace `/telemetry`, la suscripción por símbolo y los eventos `telemetry_tick`, `investment_update`, `price_alert` y `market_data_quality`.

Las alertas siguen originándose en `PriceAnalysisService`: primero se obtiene una referencia histórica válida, después se calcula la variación y finalmente se evalúa el cruce de umbral y el cooldown. El cliente WebSocket del proveedor no decide las alertas.

Los cuerpos de petición y ejemplos completos de respuesta están en la [guía de lógica, alertas y endpoints](LOGICA_INVERSION_ALERTAS_Y_ENDPOINTS.md).

## 7. Archivos principales incorporados o modificados

| Archivo | Cambio |
| --- | --- |
| [twelve-data.adapter.ts](src/modules/market-data/adapters/twelve-data.adapter.ts) | Nuevo adaptador de precios al contrato existente. |
| [market-data-adapter.interface.ts](src/modules/market-data/ports/market-data-adapter.interface.ts) | Nueva interfaz de normalización común. |
| [market-data.protocol.ts](src/modules/market-data/market-data.protocol.ts) | Nuevos tipos internos compartidos de mensajes y lotes. |
| [market-data-ws.client.ts](src/modules/market-data/market-data-ws.client.ts) | Autenticación, suscripción, recepción y heartbeat Twelve Data. |
| [market-data.config.ts](src/modules/market-data/market-data.config.ts) | Configuración y validación por proveedor. |
| [market-data.module.ts](src/modules/market-data/market-data.module.ts) y [market-data.processor.ts](src/modules/market-data/market-data.processor.ts) | Selección e inyección del adaptador. |
| [price-analysis.service.ts](src/modules/market-data/analysis/price-analysis.service.ts) | Ajuste de identificación de datos simulados; fórmulas y reglas conservadas. |
| [twelve-data-mock.server.ts](src/modules/market-data/testing/twelve-data-mock.server.ts) y [run-twelve-data-mock.ts](src/modules/market-data/testing/run-twelve-data-mock.ts) | Mock y ejecutable local del nuevo proveedor. |
| [package.json](package.json) | Nuevo comando `market-data:mock:twelve`; se mantienen los comandos anteriores, sin dependencias nuevas. |
| [market-data.integration.spec.ts](src/modules/market-data/market-data.integration.spec.ts) | Integración con ambos proveedores y comparación de contratos HTTP/Socket.IO. |
| [twelve-data.adapter.spec.ts](src/modules/market-data/adapters/twelve-data.adapter.spec.ts) y [twelve-data-ws.client.spec.ts](src/modules/market-data/twelve-data-ws.client.spec.ts) | Nuevas pruebas de normalización, conexión y manejo de fallos. |

También se ampliaron los tipos de proveedor/feed en los DTO y el estado de conexión, y se extendieron las pruebas de configuración y análisis.

## 8. Configuración y tratamiento de credenciales

El `.env` local selecciona Twelve Data con QQQ, heartbeat cada 10 segundos, timeout de heartbeat de 10 segundos y antigüedad máxima de tick de **2.000 ms**. La clave está en el archivo local ignorado por Git; este informe no la reproduce.

Se conservó el `.env` local y se documentó Twelve Data como fuente principal en [`.env.example`](../.env.example), sin credenciales reales. La URL configurable no contiene credenciales; el cliente añade la clave al construir la conexión externa y evita publicar esa URL autenticada en logs o respuestas de estado.

Si se omite `MARKET_DATA_PROVIDER`, el código selecciona **`twelvedata`** con feed `realtime`. Tener claves Alpaca en el entorno no activa ese proveedor: requiere `MARKET_DATA_PROVIDER=alpaca` explícito. No hay fallback a Alpaca. El valor general por defecto de antigüedad sigue siendo 1.000 ms; los 2.000 ms corresponden a la configuración local usada en la migración. Los valores de heartbeat por defecto son 10.000 ms para Twelve Data y 500 ms para Alpaca, con posibilidad de configurar ambos tiempos mediante variables de entorno.

## 9. Verificación realizada y límites de la evidencia

Resultados de la nueva validación posterior a la corrección del merge. Se utilizó Redis 7 en un contenedor temporal aislado, sin utilizar la base de datos del usuario ni enviar órdenes al mercado.

| Verificación | Resultado registrado |
| --- | --- |
| Suite completa con Redis habilitado | **269 pruebas aprobadas en 24 suites, ninguna omitida.** |
| Recuperación Twelve Data | Buffer de arranque, corte durante preparación, rechazo de datos antiguos, fallo de Redis, desbordamiento y ausencia de llamadas REST a Alpaca. |
| Persistencia y ATR | Redis real conserva orden de observaciones simultáneas, datos previos al corte y nueva frontera de cobertura; ATR sin alertas durante calentamiento. |
| Compilación | Correcta. |
| Lint | Sin errores ni advertencias. |
| Contratos | Comparación de estructuras HTTP y Socket.IO entre Alpaca y Twelve Data mediante mocks. La prueba Twelve Data falla si se invoca el adaptador Alpaca o su cliente histórico. |
| Negocio | Escenario 100 → 102 → 98: variaciones de referencia ±2 %, impacto estimado ±4 % y efecto monetario ±400 sobre capital de 10.000. |
| Latencia local | Pruebas controladas con entrega interna inferior a 200 ms. |
| Reconexión local | Recuperación y nueva suscripción inferiores a 2 segundos ante desconexión controlada. |
| Cuenta real Twelve Data | Prueba completa del 5 de octubre, 13:28:40–13:31:11 (America/Bogota): autenticación y suscripción correctas, 14 respuestas heartbeat y 17 precios recibidos. |
| Reconexión externa controlada | Suscripción restablecida en **930,64 ms**; preparación de continuidad en **936,34 ms**. |
| Frescura externa | **0 válidos / 17 recibidos** con el filtro de 2.000 ms. Antigüedad mínima 3.115 ms, máxima 59.180 ms y media 32.116,71 ms. |
| Entrega externa y alertas | 0 ticks persistidos, 0 entregados al dashboard y 0 alertas. ATR en `insufficientData`. |

La prueba atravesó el proveedor real, los módulos Nest de ingesta/análisis/ATR, Redis temporal y un cliente Socket.IO suscrito a QQQ. Usó una regla WINDOW de 5 segundos y umbrales de ±0,000001 % sobre la inversión para facilitar la observación de alertas; no se inyectaron precios sintéticos ni se modificó el filtro. PostgreSQL y el despliegue no formaron parte de esta prueba.

**Resultado: `NOT_READY`.** Los 17 eventos fueron rechazados como `stale`. La métrica de latencia interna tiene cero muestras: no se puede acreditar el requisito de 200 ms. `LIVE` demuestra conexión y suscripción, no disponibilidad de datos aptos para decisiones.

Los timestamps de las 17 observaciones estaban alineados al minuto. Por ello la antigüedad observada podría incluir una limitación de precisión del proveedor y no debe interpretarse automáticamente como tiempo de tránsito de red. Una comparación aproximada con la cabecera HTTP `Date` del proveedor dio −535 ms respecto del punto medio local, con 336 ms de ida/vuelta; no explica por sí sola diferencias de decenas de segundos. No se reemplazaron los tiempos originales por la recepción local.

Evidencia completa: [resultado JSON de la prueba real](../reportes/market_data/twelve_data_live_2026-10-05.json). Ejecutor reutilizable: [probe-twelve-live.cjs](scripts/probe-twelve-live.cjs). Después de compilar, se ejecuta desde `backend/` con `node --env-file=../.env scripts/probe-twelve-live.cjs`, suministrando `QA_REDIS_PORT` y `QA_REDIS_PASSWORD` de un Redis local desechable. `QA_REPORT_PATH` permite elegir otro archivo de resultado.

El Redis temporal se cerró y eliminó al finalizar. No se modificaron el `.env`, los contratos JSON de las API, el frontend ni los módulos productivos en esta prueba. Es necesario resolver la frescura/precisión efectiva del dato o acordar otro criterio de antigüedad antes de repetir la aceptación de producción.

## 10. Aspectos pendientes o fuera de esta migración

- Confirmar la frescura disponible para QQQ con la cuenta del proveedor y validar nuevamente el recorrido completo con precios elegibles. Sigue pendiente decidir si se conserva el límite de 2 segundos o se admite mayor antigüedad; no se aplicó una ampliación automática a 60 segundos.
- Se ejecutó la prueba de carga local existente con Redis real. Siguen pendientes mediciones sostenidas con el proveedor externo antes de afirmar un cumplimiento general de latencia y recuperación.
- Para Twelve Data, el historial activo se construye con precios nuevos desde el arranque o la reconexión; no se añadió descarga de ticks perdidos. Una regla WINDOW de cinco minutos necesita reunir ese período válido. Alpaca conserva la recuperación histórica que ya tenía esta rama.
- Las reglas y la ventana activa de análisis siguen en memoria de una instancia. Los ticks sí se persisten en Redis mediante el consumidor ATR existente; Twelve Data no usa esos ticks previos para presumir continuidad después de reiniciar.
- No se añadieron ejecución de órdenes, integración directa con LQQ ni cambios de interfaz de usuario.

Referencia del protocolo utilizado: [documentación oficial de streaming Twelve Data](https://support.twelvedata.com/en/articles/5620516-how-to-stream-the-data).
