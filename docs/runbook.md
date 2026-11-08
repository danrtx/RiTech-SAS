# Runbook operativo RiTech SAS

Guía para levantar, desplegar, observar, recuperar y revertir el sistema. Cada procedimiento termina en una **verificación** que confirma que el paso funcionó. Arquitectura: [arquitectura.md](arquitectura.md) · decisión: [ADR 0001](adr/0001-monolito-modular.md).

> Alcance: hoy el sistema corre en local con `docker compose` y `node`. El despliegue productivo contenerizado está pendiente ([Contenerizar y desplegar a producción](https://app.clickup.com/t/86e390ze5)); la sección 3 describe el procedimiento que ese despliegue debe respetar.

## 1. Requisitos

| Herramienta | Versión | Comprobar |
| --- | --- | --- |
| Docker Desktop / Compose v2 | 28+ | `docker compose version` |
| Node.js | 20 LTS (CI) | `node -v` |
| Flutter | stable 3.35+ | `flutter --version` |
| Acceso | `.env` local con `TWELVE_DATA_API_KEY` (no versionado) | `test -f .env` |

## 2. Puesta en marcha local

```bash
cp .env.example .env            # completar TWELVE_DATA_API_KEY si se usa el feed real
docker compose up -d            # PostgreSQL :5433 y Redis :6379
docker compose ps               # ambos "healthy"
cd backend && npm ci && npm run build
npm run start:prod              # o start:dev
```

**Verificación**

```bash
curl -s localhost:3000/health                 # {"status":"ok",...}
curl -s localhost:3000/market-data/status     # readiness.blockingReasons vacío con mercado abierto
curl -s localhost:3000/hedging/latency        # budgetMs 200
curl -s localhost:3000/notifications/status   # sender "fcm" o "disabled"
```

Sin feed real (fines de semana o sin clave): `MARKET_DATA_PROVIDER=twelvedata MARKET_DATA_FEED=mock MARKET_DATA_WS_URL=ws://127.0.0.1:8765/v2/mock` y `npm run market-data:mock:twelve` en otra terminal.

App: `cd frontend_mobile && flutter run --dart-define=API_BASE_URL=http://<host>:3000 --dart-define=WS_BASE_URL=http://<host>:3000/telemetry` (más las variables `FIREBASE_*` de la sección 5 para push).

## 3. Despliegue

1. **Antes de unir a `main`**: el PR tiene CI en verde (backend, mobile, paquetes ATR y `definition-of-done`). Revisar el resumen del job DoD y el artefacto `latency-report`.
2. **Construir** desde el commit etiquetado: `git tag vX.Y.Z && npm ci && npm run build`. El artefacto es `backend/dist/` junto con `package-lock.json`.
3. **Migraciones**: TypeORM aplica `migrations/` al arrancar (`synchronize` desactivado). Respaldar PostgreSQL antes (sección 6.3) si el release trae migraciones nuevas.
4. **Arrancar la versión nueva** con las mismas variables de entorno y, en producción, `NODE_ENV=production` (bloquea los feeds `mock`/`test` y exige el tópico `*-production`).
5. **Verificar** con los cuatro `curl` de la sección 2. Durante 5 minutos con mercado abierto, `GET /hedging/latency` debe tener `withinBudget: true` y `GET /market-data/status`, `connection.state: "LIVE"`.

> Ejecutar **una sola réplica** del backend por símbolo: el estado del episodio de stop-loss está en memoria y dos réplicas duplicarían solicitudes (ver ADR 0001).

## 4. Rollback

Criterios para revertir (cualquiera): `/health` en 503 por más de 2 minutos, `withinBudget: false` sostenido, `stop_loss_delivery_failed` repetido en los logs o una regresión funcional confirmada.

1. Detener el proceso actual (`SIGTERM`; Nest cierra las conexiones con `enableShutdownHooks`).
2. Desplegar el tag anterior: `git checkout vX.Y.(Z-1) && npm ci && npm run build && npm run start:prod`.
3. Si la versión revertida trajo una migración incompatible, restaurar el respaldo de PostgreSQL de la sección 6.3 **antes** de arrancar.
4. **Verificar** con la sección 2 y registrar el incidente (sección 7).

App móvil: volver a publicar el build anterior en el canal interno. Los payloads push son `schemaVersion: "1"`, así que una app anterior sigue aceptando las alertas mientras el backend no cambie de versión.

## 5. Notificaciones push (FCM) por ambiente

| Paso | Detalle |
| --- | --- |
| Proyecto | Un proyecto Firebase por ambiente (`ritech-dev`, `ritech-test`, `ritech-prod`). Nunca compartir tópico entre ambientes. |
| Cuenta de servicio | Solo el rol **Firebase Cloud Messaging API Admin**. Descargar la clave JSON fuera del repositorio (por ejemplo, `~/.secrets/ritech-fcm-dev.json`) con permisos de solo lectura para el usuario del servicio. |
| Backend | `FCM_ENABLED=true`, `FCM_PROJECT_ID=<id>`, `FCM_CREDENTIALS_PATH=<ruta .json>` (o ADC en la nube); opcionales: `FCM_TOPIC` (por defecto `hedging-alerts-<ambiente>`), `FCM_SEND_TIMEOUT_MS=5000`, `FCM_QUEUE_CAPACITY=256`. |
| App | Registrar en el proyecto Firebase la app Android `com.ritechsas.ritech_mobile` y la iOS `com.ritechsas.ritechMobile`. Ejecutar con `--dart-define=FIREBASE_API_KEY=… FIREBASE_APP_ID=… FIREBASE_MESSAGING_SENDER_ID=… FIREBASE_PROJECT_ID=…` (web: también `FCM_VAPID_KEY`). Opcionalmente colocar `android/app/google-services.json` y `ios/Runner/GoogleService-Info.plist`; están en `.gitignore`. iOS: subir la clave APNs (.p8) en la consola de Firebase y activar Push Notifications en el perfil de firma; `Runner.entitlements` usa `aps-environment=development`. Emulador Android: `API_BASE_URL=http://10.0.2.2:3000`. |
| Rotación | Crear una clave nueva, actualizar `FCM_CREDENTIALS_PATH`, reiniciar, verificar `/notifications/status`, borrar la clave vieja en la consola de GCP. |

Valores de la app por ambiente: copiar `frontend_mobile/dart_defines/example.json` a `dev.android.json` (ignorado por git) con los datos de `firebase apps:sdkconfig android`.

**Problemas conocidos al compilar Android en Windows**

| Síntoma | Causa | Solución |
| --- | --- | --- |
| `Unable to establish loopback connection` | La JVM no puede crear sockets en un `TEMP` con ruta larga | `$env:TMP='C:\Temp'; $env:TEMP='C:\Temp'` antes de compilar |
| `Failed to create parent directory 'C:\Users\NOMBRE'` (ruta con `\ `) | `--dart-define-from-file` y la caché incremental escapan mal los espacios de la ruta del repo | Pasar cada valor con `--dart-define=CLAVE=valor` y ejecutar `flutter clean` antes de compilar con valores nuevos |
| La app muestra "Sin conexión" en el emulador | Otro proceso ocupa `127.0.0.1:3000` en el host (`10.0.2.2` apunta ahí) | Levantar el backend con `PORT=3001` y usar `API_BASE_URL=http://10.0.2.2:3001` |

**Verificación**: `GET /notifications/status` → `sender: "fcm"`. Registrar un dispositivo desde la app (estado `registered`) y provocar una caída con el mock: `sent` aumenta y el teléfono muestra «Hedging activado en QQQ». Un fallo de FCM incrementa `failed`, registra `push_failed` con un código estable y **no** detiene el stop-loss.

## 6. Recuperación

### 6.1 Pérdida del proveedor de mercado

Síntomas: `market-data/status` → `connection.state` distinto de `LIVE` y `blockingReasons: ["TRANSPORT_UNAVAILABLE"]`. El cliente reconecta solo, con backoff de 100 ms a 5 s. Mientras dura el corte, el análisis se suspende y no se decide con el último precio conocido.

1. Revisar los logs: `market_data_analysis_invalidated` y su `reason`.
2. Si persiste más de 5 minutos: comprobar la cuota y la clave de Twelve Data en el panel del proveedor y reiniciar el backend.
3. **Verificar**: `connection.state: "LIVE"` y `readiness.freshDataReady: true`.

### 6.2 Redis caído

`/health` → 503 con `services.redis.status: "down"`. `docker compose restart redis`. AOF conserva la ventana de ticks. Al volver, la recuperación excluye el minuto parcial del ATR. **Verificar**: `/health` en `ok` y `atr_result` nuevamente con `status: "ready"` tras la ventana de calentamiento.

### 6.3 PostgreSQL: respaldo y restauración

```bash
docker compose exec -T postgres pg_dump -U ritech -d ritech -Fc > backup_$(date +%F).dump
docker compose exec -T postgres pg_restore -U ritech -d ritech --clean < backup_YYYY-MM-DD.dump
```

**Verificar**: `GET /market-data/chart?date=<fecha respaldada>` devuelve las velas esperadas.

### 6.4 Latencia fuera de presupuesto

`GET /hedging/latency` → `withinBudget: false`. El campo `slowestSegment` indica dónde está el retraso:

| `slowestSegment` | Causa probable | Acción |
| --- | --- | --- |
| `ingestionQueue` | El consumidor está ocupado; Redis o el event loop van lentos | Revisar la latencia de `/health` hacia Redis y la CPU del proceso. |
| `consumerProcessing` | Escritura en Redis o análisis | Revisar la red hacia Redis y el tamaño del historial. |
| `hedgingQueue` | Ráfagas mayores a 128 ticks por lote | Revisar picos en `ingestion.received` de `/market-data/status`. |

Reproducir fuera de producción con `npm run qa:latency -- --redis --rate=<ticks/s>`.

## 7. Respuesta a incidentes

| Severidad | Ejemplo | Respuesta |
| --- | --- | --- |
| SEV1 | Stop-loss no solicitado ante una caída real, o solicitudes duplicadas | Detener la ingesta (`MARKET_DATA_ENABLED=false` y reiniciar), avisar al responsable de trading y aplicar rollback. |
| SEV2 | Push sin entregar o datos `stale` sostenidos | Revisar las secciones 5 y 6.1. El stop-loss sigue operando por Socket.IO. |
| SEV3 | Gráfica histórica incompleta | Ticket ordinario. |

Pasos: 1) declarar el incidente y nombrar un responsable; 2) estabilizar (rollback o aislamiento); 3) conservar la evidencia (`/market-data/status`, `/hedging/latency`, `/notifications/status` y logs), sin incluir `.env` ni claves; 4) postmortem sin culpables en las siguientes 48 horas, con acciones registradas en ClickUp.

## 8. Prueba guiada del runbook

Una persona distinta al autor ejecuta esta lista y la firma (criterio de la tarea ClickUp):

- [ ] Sección 2 completa con el feed mock; los cuatro `curl` responden como se describe.
- [ ] `npm run qa:latency -- --redis --duration=10000` genera un reporte `PASS` en `reportes/latencia/`.
- [ ] Sección 6.2: detener Redis, ver `/health` en 503, reiniciarlo y ver `ok`.
- [ ] Sección 4: hacer rollback a un tag anterior y volver al actual.
- [ ] Sección 6.3: respaldar y restaurar en una base local de prueba.

Ejecutó: __________ · Fecha: __________ · Desvíos encontrados: __________
