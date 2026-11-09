# ADR 0001: monolito modular NestJS en lugar de microservicios

- **Estado:** propuesto (pendiente de aprobación del equipo)
- **Fecha:** 2026-11-04 · revisado el 2026-11-09 tras el sprint 4
- **Responsable:** Danilo Montezuma (DevOps y QA)
- **Tarea:** [Documentar arquitectura y operaciones con ADR](https://app.clickup.com/t/86e390ze7)

## Contexto

RiTech SAS cubre posiciones expuestas al NASDAQ 100. El backend recibe precios en tiempo real (Twelve Data, con Alpaca como alternativa), calcula ATR y la velocidad de caída, decide un stop-loss y lo comunica a la app Flutter por Socket.IO y push (FCM).

Restricciones que pesan en la decisión:

| Fuerza | Detalle |
| --- | --- |
| Latencia (NFR-001) | La comunicación ingesta → hedging no debe superar **200 ms**. Cada salto de red entre procesos consume parte de ese margen y agrega un modo de fallo. |
| Consistencia del episodio | El tick que dispara el stop-loss tiene que ser el mismo que se persistió y analizó. `MarketAtrConsumer` garantiza el orden caché → análisis → hedging en un único camino de entrega. |
| Tamaño del equipo | Cuatro personas, un sprint por épica. No hay capacidad para operar un *service mesh*, colas distribuidas ni varios pipelines de despliegue. |
| Operación | Un solo proveedor de mercado y un símbolo (QQQ como proxy del NDX). La carga esperada ronda las decenas o cientos de ticks por segundo, muy por debajo de lo que un proceso Node atiende. |
| Evolución | El conector FIX/API del bróker y la bitácora regulatoria vienen en camino. Deben poder extraerse más adelante sin reescribir el núcleo. |

## Decisión

Un **monolito modular** NestJS desplegado como un solo proceso. Los módulos se comunican en memoria a través de puertos explícitos:

- `market-data`: adaptadores de proveedor (`MarketDataAdapter`), `MarketDataProcessor` (cola acotada, deduplicación y orden) y `MarketAtrConsumer` (puerto `TickConsumer`).
- `atr` y `market-chart`: cálculo del ATR por minuto y archivo de velas en PostgreSQL.
- `hedging`: `DynamicStopLoss` (máquina de estados pura), `StopLossService` (cola en proceso) y `PipelineLatencyService` (NFR-001).
- `notifications`: `PushNotificationService` con el puerto `PushSender` (FCM o deshabilitado).
- `telemetry`: gateway Socket.IO `/telemetry` hacia la app.
- `redis-cache`, `database` y `health`: infraestructura.

Las reglas que hacen extraíble a un módulo:

1. Solo se depende de interfaces declaradas (`TICK_CONSUMER`, `MARKET_DATA_ADAPTER`, `PUSH_SENDER`) o de servicios exportados por su módulo.
2. Ningún módulo de dominio llama a la red de forma síncrona dentro del camino de ingesta. FCM y el bróker van detrás de colas acotadas y nunca bloquean el trading.
3. Los contratos que cruzan el límite del proceso (Socket.IO, push y HTTP) tienen `schemaVersion`.

## Alternativas consideradas

| Alternativa | Ventajas | Por qué no ahora |
| --- | --- | --- |
| **Microservicios** (ingesta, hedging y notificaciones separados, comunicados por Redis Streams/Kafka) | Escalado y despliegue independientes; aislamiento de fallos por servicio. | Agrega al menos un salto de red y la serialización en el camino crítico de 200 ms. Exige garantías de entrega y orden entre procesos que hoy da el event loop. Multiplica pipelines, observabilidad distribuida y secretos. La carga actual no justifica escalar por separado. |
| **Monolito sin módulos** | Lo más simple de arrancar. | Acopla proveedor, decisión y notificación. Impide sustituir el bróker mock o FCM en pruebas e impide extraer servicios después. |
| **Funciones serverless** para notificaciones | No hay que operar servidores para FCM. | Arranques en frío impredecibles. Otro proveedor de despliegue y de secretos. El volumen de alertas es bajo. |

## Consecuencias

**Positivas**

- La latencia medida ingesta → motor con Redis real queda en p50 7,2 ms, p95 23,2 ms y máximo 108 ms a 200 ticks/s en un equipo de desarrollo ([evidencia](../../reportes/latencia/)), y en p50 0,76 ms, p95 1,46 ms y máximo 12,06 ms en el CI del 9 de noviembre: dentro del presupuesto.
- Hay un solo artefacto que construir, versionar y desplegar, y el rollback consiste en volver a la imagen anterior.
- Las pruebas E2E recorren el camino real en un proceso (`hedging-flow.e2e.spec.ts`, `latency-benchmark.spec.ts`).

**Negativas y riesgos aceptados**

- **Un proceso es un único punto de fallo.** Si se cae, se detienen ingesta, decisión y alertas. Mitigación: `restart: unless-stopped` o un orquestador con *health check* sobre `/health`, y la recuperación con continuidad que ya trae `market-data`.
- **El escalado es vertical.** Una réplica activa por símbolo: dos réplicas duplicarían solicitudes de stop-loss porque el estado del episodio está en memoria. Escalar horizontalmente requiere un *leader election* o extraer `hedging`.
- **El bloqueo del event loop afecta a todos los módulos.** Mitigación: colas acotadas, trabajo por lotes con `setImmediate` y el tramo `ingestionQueue` de `/hedging/latency` como alerta temprana.

**Criterios para revisar esta decisión** (cualquiera de ellos):

- Más de un símbolo con requisitos de latencia independientes, o una carga sostenida mayor a 2.000 ticks/s.
- Un p95 del tramo `total` por encima de 100 ms en producción durante una semana.
- Requisitos regulatorios que obliguen a aislar la ejecución de órdenes (conector FIX) del resto del sistema.

## Revisión del 9 de noviembre de 2026 (cierre del sprint 4)

La decisión se mantiene. En el sprint 4 entraron cuatro módulos nuevos sin cambiar el núcleo, que es lo que el diseño modular buscaba:

| Módulo nuevo | Cómo respeta las reglas de la decisión |
| --- | --- |
| `broker` (órdenes IOC a IBKR paper) | Fuera del camino crítico: el stop-loss no lo llama de forma automática y cada orden queda en PostgreSQL con clave única antes de enviarse |
| `hedging/PaperExecutionService` | Llamado desde el stop-loss dentro de su propio `try/catch`; un fallo no afecta las alertas ni el motor |
| `investment` (agente con Gemini) | Consulta bajo demanda desde la app, nunca dentro de la ingesta; sin acceso al bróker |
| `backtesting` | Reutiliza `DynamicStopLoss` tal cual, sin una copia del motor |

El conector del bróker, que el contexto original mencionaba como trabajo pendiente, ya existe como módulo y podría extraerse a un servicio aparte si una norma lo exigiera (tercer criterio de revisión). Ninguno de los criterios de revisión se cumplió en este sprint.

Los tres destinos de despliegue (Docker Compose, Azure Container Apps y AWS en el PR #33) corren **una sola réplica**, como exige la segunda consecuencia negativa. El runbook registra que el despliegue en Azure permite apagar la réplica sin tráfico (`--min-replicas 0`), lo que no duplica decisiones pero sí interrumpe la ingesta en vivo.

Diagramas y detalle operativo: [arquitectura](../arquitectura.md) · [runbook](../runbook.md).
