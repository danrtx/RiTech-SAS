# Arquitectura implementada

Este documento describe el código de `main` al 4 de noviembre de 2026. La decisión de fondo está en el [ADR 0001](adr/0001-monolito-modular.md) y la operación, en el [runbook](runbook.md).

## Contexto

```mermaid
flowchart LR
  subgraph Proveedores
    TD[Twelve Data WS<br/>QQQ realtime]
    AP[Alpaca WS<br/>opcional / pruebas]
  end
  subgraph Backend["Backend NestJS (un proceso)"]
    BE[Monolito modular]
  end
  PG[(PostgreSQL 16<br/>velas y observaciones)]
  RD[(Redis 7<br/>ticks y ventana ATR)]
  FCM[Firebase Cloud Messaging]
  APP[App Flutter<br/>Android / iOS / Web]
  BRK[Bróker FIX/API<br/>pendiente: hoy mock HTTP]

  TD -->|precios| BE
  AP -.->|trades| BE
  BE <--> RD
  BE <--> PG
  BE -->|Socket.IO /telemetry| APP
  BE -->|HTTP REST| APP
  BE -->|push por tópico| FCM --> APP
  BE -.->|solicitud stop-loss| BRK
```

## Módulos del backend

```mermaid
flowchart TB
  subgraph market-data
    AD[Adaptadores<br/>TwelveData / Alpaca] --> PR[MarketDataProcessor<br/>cola, dedup, orden]
    PR -->|TickConsumer| CO[MarketAtrConsumer]
    CO --> PA[PriceAnalysisService]
    RC[MarketRecoveryService]
  end
  subgraph hedging
    SL[StopLossService<br/>cola 4096, lotes 128] --> DS[DynamicStopLoss]
    LT[PipelineLatencyService<br/>GET /hedging/latency]
    IA[InvestmentAnalysisService]
  end
  subgraph notifications
    PN[PushNotificationService<br/>cola 256, timeout 5 s] --> PS{{PushSender<br/>FCM / deshabilitado}}
  end
  subgraph telemetry
    GW[TelemetryGateway<br/>Socket.IO]
  end
  ATR[atr] ; CH[market-chart] ; RCM[redis-cache] ; DB[database] ; HL[health]

  CO --> RCM
  CO --> ATR
  CO --> SL
  PA --> IA
  PA --> GW
  SL --> LT
  SL -->|hedging_alert| GW
  SL -->|encola| PN
  CH --> DB
  HL --> DB & RCM
```

## Camino crítico: tick → decisión → alerta

```mermaid
sequenceDiagram
  autonumber
  participant WS as Proveedor WS
  participant PR as MarketDataProcessor
  participant CO as MarketAtrConsumer
  participant RD as Redis
  participant SL as StopLossService
  participant DS as DynamicStopLoss
  participant GW as TelemetryGateway
  participant PN as PushNotificationService
  participant FCM as FCM

  WS->>PR: frame (receivedAtMonotonicMs)
  Note over PR: ingestionQueue
  PR->>CO: consume(tick, {receivedAtMonotonicMs})
  CO->>RD: appendTick (Lua atómico)
  CO->>CO: análisis de precio y ATR
  Note over CO: consumerProcessing
  CO->>SL: enqueue(tick, trace)
  Note over SL: hedgingQueue (setImmediate)
  SL->>DS: accept(sample) → fin de la medición NFR-001
  DS-->>SL: StopLossTrigger (si hay caída)
  SL->>GW: hedging_alert (Socket.IO)
  SL->>PN: notifyHedgingActivated (síncrono, sin await)
  PN-->>FCM: send(topic, data v1) en segundo plano
```

`/hedging/latency` reporta p50, p95 y máximo por tramo, además del `slowestSegment`. El reporte reproducible se genera con `npm run qa:latency -- --redis` y queda en `reportes/latencia/`.

## Contratos versionados

| Canal | Evento / ruta | Versión | Productor → consumidor |
| --- | --- | --- | --- |
| Socket.IO `/telemetry` | `telemetry_tick`, `atr_result`, `chart_candle`, `price_alert`, `investment_update`, `market_data_quality` | `schemaVersion` en el tick | Backend → app |
| Socket.IO `/telemetry` | `hedging_alert` (`action: STOP_LOSS_REQUEST`, `executionStatus: REQUESTED`) | `schemaVersion: 1` | Backend → app |
| FCM `data` | `type: HEDGING_ACTIVATED`, `correlationId`, `symbol`, `policy`, `price`, `fallPercentPerMinute`, `triggeredAtMs`, `route` | `schemaVersion: "1"` | Backend → app |
| HTTP | `POST/DELETE /notifications/devices`, `GET /notifications/status` | n/a | App → backend |
| HTTP | `GET /hedging/latency`, `GET /health`, `GET /market-data/status`, `/market-data/*`, `/atr` | n/a | Operación / app |

La app Flutter **descarta** los payloads push con otra versión o con campos inválidos. La ruta de navegación se reconstruye en el cliente a partir de `correlationId` y nunca se toma del campo `route` del payload.

## App móvil

```mermaid
flowchart LR
  main[main.dart<br/>FirebaseBootstrap] --> app[RiTechApp<br/>router + aviso en app]
  app --> router[GoRouter<br/>/dashboard · /hedging · /orders/:id]
  app --> pc[PushNotificationsController]
  pc --> mc[PushMessagingClient<br/>firebase_messaging]
  pc --> reg[DeviceRegistrationApi<br/>POST /notifications/devices]
  pc --> ln[LocalAlertNotifier<br/>canal hedging_alerts]
  router --> detail[OrderDetailScreen]
  router --> dash[TelemetryDashboardScreen<br/>Socket.IO + gráfica]
```

| Estado de la app | Quién muestra la alerta | Cómo se abre el detalle |
| --- | --- | --- |
| Foreground | Notificación local, más un aviso con el botón «Ver» | Toque → `openAlert` → `/orders/:id` |
| Background | El sistema operativo (bloque `notification` de FCM) | `onMessageOpenedApp` |
| Terminada | El sistema operativo | `getInitialMessage`, que queda pendiente hasta el primer frame |

## Despliegue actual

```mermaid
flowchart LR
  dev[Equipo] -->|PR| gh[GitHub Actions<br/>lint · tests · cobertura · NFR-001 · DoD · Sonar]
  gh -->|merge main| main[(main)]
  subgraph Local["Máquina de desarrollo (docker compose)"]
    pg[(ritech-postgres :5433)]
    rd[(ritech-redis :6379)]
    node[node dist/main :3000]
  end
  main -->|npm run build| node
  node --> pg & rd
```

La contenerización y el despliegue a producción siguen pendientes ([Contenerizar y desplegar a producción](https://app.clickup.com/t/86e390ze5)). Cuando existan, este diagrama y el runbook deben actualizarse con el destino real.
