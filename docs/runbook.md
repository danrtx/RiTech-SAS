# Runbook operativo RiTech SAS

Guía para levantar, desplegar, observar, recuperar y revertir el sistema. Cada procedimiento termina en una **verificación** que confirma que el paso funcionó. Arquitectura: [arquitectura.md](arquitectura.md) · decisión: [ADR 0001](adr/0001-monolito-modular.md) · cierre de calidad: [acta DoD del sprint 4](ACTA_DOD_SPRINT4.md).

> Estado al 9 de noviembre de 2026 (`main` en `c60a1ab`): hay despliegue con Docker Compose y script de Azure en `main`; el despliegue en AWS con HTTPS está en revisión ([PR #33](https://github.com/danrtx/RiTech-SAS/pull/33)). La sección 3.4 lista dos problemas conocidos del despliegue que deben resolverse antes de producción.

## 1. Requisitos

| Herramienta | Versión | Comprobar |
| --- | --- | --- |
| Docker Desktop / Compose v2 | 28+ | `docker compose version` |
| Node.js | 20 LTS (CI e imagen) | `node -v` |
| Flutter | stable 3.35+ | `flutter --version` |
| Azure CLI (solo despliegue en Azure) | 2.x | `az --version` |
| Acceso | `.env` con las claves del ambiente (no versionado) | `test -f .env` |

## 2. Puesta en marcha local

```bash
cp .env.example .env            # completar las claves que se vayan a usar
docker compose up -d            # PostgreSQL :5433 y Redis :6379
docker compose ps               # ambos "healthy"
cd backend && npm ci && npm run build
npm run start:dev               # en local; start:prod exige Node con TLS 1.3
```

**Verificación**

```bash
curl -s localhost:3000/health                 # {"status":"ok",...}
curl -s localhost:3000/market-data/status     # readiness.blockingReasons vacío con mercado abierto
curl -s localhost:3000/hedging/latency        # budgetMs 200
curl -s localhost:3000/notifications/status   # sender "fcm" o "disabled"
```

Sin feed real (fines de semana o sin clave): `MARKET_DATA_PROVIDER=twelvedata MARKET_DATA_FEED=mock MARKET_DATA_WS_URL=ws://127.0.0.1:8765/v2/mock` y `npm run market-data:mock:twelve` en otra terminal.

App: `cd frontend_mobile && flutter run --dart-define=API_BASE_URL=http://<host>:3000 --dart-define=WS_BASE_URL=http://<host>:3000/telemetry` (más las variables `FIREBASE_*` de la sección 5 para push). Web local: `scripts/start-web-local.ps1`.

### 2.1 Modos de operación

| Variable | Valores | Efecto |
| --- | --- | --- |
| `EXECUTION_MODE` | vacío (por defecto), `paper`, `ibkr-paper` | Sin valor no se ejecuta nada. `paper` acepta el stop-loss en una cuenta simulada en memoria y emite `execution_notification`. `ibkr-paper` habilita el envío IOC explícito a una cuenta paper de IBKR |
| `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL` | `true` / `false` | Activa el agente de análisis de `/investment`. Sin clave, el agente responde «no disponible» |
| `FCM_ENABLED` | `true` / `false` | Alertas push reales (sección 5) |
| `MARKET_DATA_ENABLED` | `true` / `false` | Ingesta de precios en vivo |

Ningún modo ejecuta órdenes reales: `ibkr-paper` solo opera contra cuentas `DU…` (paper) y el agente de inversión no tiene acceso al bróker.

## 3. Despliegue

### 3.1 Antes de desplegar

1. El PR tiene el CI en verde: backend, app móvil, paquetes ATR y `definition-of-done`. Revisar el resumen del acta y el artefacto `latency-report`.
2. Si el release trae migraciones nuevas, respaldar PostgreSQL (sección 6.3). TypeORM las aplica al arrancar; `synchronize` está desactivado.
3. Producción exige: `NODE_ENV=production`, Node con `--tls-min-v1.3` (la imagen y `npm run start:prod` ya lo pasan), `DB_TLS_ENABLED=true` y `REDIS_TLS_ENABLED=true` (con `DB_TLS_CA_FILE` / `REDIS_TLS_CA_FILE` si la CA es privada) y, para HTTPS directo, `SERVER_TLS_ENABLED=true` con `SERVER_TLS_CERT_FILE` y `SERVER_TLS_KEY_FILE`. Sin TLS hacia los almacenes, el backend se niega a arrancar.

### 3.2 Servidor con Docker Compose

```bash
./scripts/deploy.sh v1.4.0           # construye ritech-backend:v1.4.0, lo levanta y espera el health check (60 s)
```

La imagen (`backend/Dockerfile`) es multi-etapa sobre `node:20-alpine`, corre con un usuario sin privilegios, usa `tini` como proceso 1 y trae un `HEALTHCHECK` cada 15 s. El stack completo está en `docker-compose.prod.yml` (PostgreSQL, Redis con AOF y límite de 256 MB, backend con límite de 512 MB).

**Verificación:** `docker inspect --format='{{.State.Health.Status}}' ritech-prod-backend` → `healthy`, y los cuatro `curl` de la sección 2 contra el host.

### 3.3 Azure Container Apps

```bash
az login
export UPSTASH_REDIS_HOST=… UPSTASH_REDIS_PORT=… UPSTASH_REDIS_PASSWORD=…
./scripts/azure-deploy.sh
```

Crea el grupo de recursos, un Container Registry, PostgreSQL Flexible Server y una Container App con ingreso HTTPS, de 0 a 1 réplicas. Las contraseñas se guardan como *secrets* de la Container App, no como texto. Por defecto deja `MARKET_DATA_ENABLED=false` y `FCM_ENABLED=false`.

**Verificación:** el script imprime la URL pública; `curl https://<url>/health` → `ok`.

### 3.4 Problemas conocidos (resolver antes de producción)

| Problema | Efecto | Solución propuesta |
| --- | --- | --- |
| `docker-compose.prod.yml` y `azure-deploy.sh` no definen `DB_TLS_ENABLED` ni `REDIS_TLS_ENABLED`, y sus PostgreSQL y Redis no tienen TLS | Con `NODE_ENV=production` el backend se detiene al arrancar | Habilitar TLS en los almacenes y agregar las variables, como hace el [PR #33](https://github.com/danrtx/RiTech-SAS/pull/33) para AWS |
| `deploy.sh` toma la versión anterior de una etiqueta `deploy.tag` que la imagen no define | `.last-deploy-tag` queda vacío y el rollback automático no sabe a qué volver | Pasar siempre la versión al hacer rollback (sección 4) o agregar `LABEL deploy.tag` al construir |
| Azure con `--min-replicas 0` | La app se apaga sin tráfico; el primer pedido tarda en arrancar y la ingesta en vivo se interrumpe | Usar `--min-replicas 1` si se activa `MARKET_DATA_ENABLED` |

> Ejecutar **una sola réplica** del backend por símbolo: el estado del episodio de stop-loss está en memoria y dos réplicas duplicarían solicitudes (ver ADR 0001). Los tres destinos actuales respetan este límite.

## 4. Rollback

Criterios para revertir (cualquiera): `/health` en 503 por más de 2 minutos, `withinBudget: false` sostenido, `stop_loss_delivery_failed` o `stop_loss_execution_failed` repetidos en los logs, o una regresión funcional confirmada.

```bash
./scripts/rollback.sh v1.3.0         # vuelve a la imagen ritech-backend:v1.3.0 y espera el health check
```

1. Si la versión revertida no es compatible con una migración nueva, restaurar el respaldo de PostgreSQL de la sección 6.3 **antes** del rollback.
2. Si la imagen ya no existe en el host, reconstruirla: `DEPLOY_TAG=v1.3.0 docker compose -f docker-compose.prod.yml build backend`.
3. En Azure: `az containerapp update --name ritech-backend --resource-group ritech-rg --image <registro>/ritech-backend:<versión anterior>`.
4. **Verificar** con la sección 2 y registrar el incidente (sección 7).

App móvil: volver a publicar el build anterior en el canal interno (`scripts/build-apk.sh` genera el APK firmado). Los payloads push son `schemaVersion: "1"`, así que una app anterior sigue aceptando las alertas mientras el backend no cambie de versión.

## 5. Notificaciones push (FCM) por ambiente

| Paso | Detalle |
| --- | --- |
| Proyecto | Un proyecto Firebase por ambiente. Hoy existe `ritech-sas-dev`; falta el de pruebas. Nunca compartir tópico entre ambientes. |
| Cuenta de servicio | Solo el rol **Firebase Cloud Messaging API Admin**. Descargar la clave JSON fuera del repositorio (por ejemplo, `~/.secrets/ritech-fcm-dev.json`) con permisos de solo lectura para el usuario del servicio. |
| Backend | `FCM_ENABLED=true`, `FCM_PROJECT_ID=<id>`, `FCM_CREDENTIALS_PATH=<ruta .json>` (o ADC en la nube); opcionales: `FCM_TOPIC` (por defecto `hedging-alerts-<ambiente>`), `FCM_SEND_TIMEOUT_MS=5000`, `FCM_QUEUE_CAPACITY=256`. |
| App | Registrar en el proyecto Firebase la app Android `com.ritechsas.ritech_mobile` y la iOS `com.ritechsas.ritechMobile`. Ejecutar con `--dart-define=FIREBASE_API_KEY=… FIREBASE_APP_ID=… FIREBASE_MESSAGING_SENDER_ID=… FIREBASE_PROJECT_ID=…` (web: también `FCM_VAPID_KEY`). Opcionalmente colocar `android/app/google-services.json` y `ios/Runner/GoogleService-Info.plist`; están en `.gitignore`. Emulador Android: `API_BASE_URL=http://10.0.2.2:3000`. |
| iOS | Configurado pero no verificado en dispositivo (excepción acordada en el acta DoD). Para verificarlo: Mac con Xcode, cuenta paga de Apple Developer, subir la clave APNs (.p8) a Firebase y activar Push Notifications en el perfil de firma. |
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

`/health` → 503 con `services.redis.status: "down"`. `docker compose restart redis` (producción: `docker compose -f docker-compose.prod.yml restart redis`). AOF conserva la ventana de ticks. Al volver, la recuperación excluye el minuto parcial del ATR. **Verificar**: `/health` en `ok` y `atr_result` nuevamente con `status: "ready"` tras la ventana de calentamiento.

### 6.3 PostgreSQL: respaldo y restauración

```bash
docker compose exec -T postgres pg_dump -U ritech -d ritech -Fc > backup_$(date +%F).dump
docker compose exec -T postgres pg_restore -U ritech -d ritech --clean < backup_YYYY-MM-DD.dump
```

En el stack de producción usar `-f docker-compose.prod.yml` y el contenedor `ritech-prod-postgres`. **Verificar**: `GET /market-data/chart?date=<fecha respaldada>` devuelve las velas esperadas.

### 6.4 Latencia fuera de presupuesto

`GET /hedging/latency` → `withinBudget: false`. El campo `slowestSegment` indica dónde está el retraso:

| `slowestSegment` | Causa probable | Acción |
| --- | --- | --- |
| `ingestionQueue` | El consumidor está ocupado; Redis o el event loop van lentos | Revisar la latencia de `/health` hacia Redis y la CPU del proceso. |
| `consumerProcessing` | Escritura en Redis o análisis | Revisar la red hacia Redis y el tamaño del historial. |
| `hedgingQueue` | Ráfagas mayores a 128 ticks por lote | Revisar picos en `ingestion.received` de `/market-data/status`. |

Reproducir fuera de producción con `npm run qa:latency -- --redis --rate=<ticks/s>`.

### 6.5 Orden IOC en estado incierto (`SUBMITTING` o `UNKNOWN`)

Solo aplica con `EXECUTION_MODE=ibkr-paper`. Una caída del proceso después de registrar la intención deja `SUBMITTING`; una respuesta perdida deja `UNKNOWN`. El sistema **no** reenvía esas órdenes, para no duplicarlas.

1. Si la orden tiene ID del bróker, consultar su estado con `refresh(clientId)`.
2. Si no lo tiene, buscarla por `cOID` en la cuenta paper de IBKR y reconciliar a mano.
3. **Nunca** borrar registros de `broker_order_events` para forzar un reintento.

Detalle completo: [historia IOC del bróker](HISTORIA_IOC_BROKER.md).

### 6.6 Agente de inversión no disponible

La pantalla `/investment` muestra «servicio no disponible» y el backend registra códigos `GEMINI_*` (`GEMINI_NO_CONFIGURADO`, `GEMINI_CUOTA`, `GEMINI_TIEMPO_AGOTADO`…). El trading no depende del agente.

1. `GEMINI_NO_CONFIGURADO` o `GEMINI_AUTENTICACION`: revisar `GEMINI_ENABLED` y `GEMINI_API_KEY`.
2. `GEMINI_CUOTA`: esperar a que se renueve la cuota del proveedor; los límites internos por hora son `INVESTMENT_GENERAL_CALLS_HOUR` e `INVESTMENT_SERVICE_CALLS_HOUR`.
3. **Verificar**: una nueva consulta devuelve una recomendación persistida (HTTP 201).

Detalle completo: [agente Gemini](AGENTE_GEMINI_SPRINT4.md).

## 7. Respuesta a incidentes

| Severidad | Ejemplo | Respuesta |
| --- | --- | --- |
| SEV1 | Stop-loss no solicitado ante una caída real, solicitudes u órdenes duplicadas | Detener la ingesta (`MARKET_DATA_ENABLED=false`) y la ejecución (`EXECUTION_MODE` vacío), reiniciar, avisar al responsable de trading y aplicar rollback. |
| SEV2 | Push sin entregar, datos `stale` sostenidos u orden en `UNKNOWN` | Revisar las secciones 5, 6.1 y 6.5. El stop-loss sigue operando por Socket.IO. |
| SEV3 | Gráfica histórica incompleta o agente de inversión no disponible | Ticket ordinario; sección 6.6. |

Pasos: 1) declarar el incidente y nombrar un responsable; 2) estabilizar (rollback o aislamiento); 3) conservar la evidencia (`/market-data/status`, `/hedging/latency`, `/notifications/status` y logs), sin incluir `.env` ni claves; 4) postmortem sin culpables en las siguientes 48 horas, con acciones registradas en ClickUp.

## 8. Prueba guiada del runbook

Una persona distinta al autor ejecuta esta lista y la firma (criterio de la tarea [Documentar arquitectura y operaciones con ADR](https://app.clickup.com/t/86e390ze7)):

- [ ] Sección 2 completa con el feed mock; los cuatro `curl` responden como se describe.
- [ ] `npm run qa:latency -- --redis --duration=10000` genera un reporte `PASS` en `reportes/latencia/`.
- [ ] Sección 6.2: detener Redis, ver `/health` en 503, reiniciarlo y ver `ok`.
- [ ] Sección 3.2: desplegar una versión con `./scripts/deploy.sh <versión>` y ver el contenedor `healthy`.
- [ ] Sección 4: volver a la versión anterior con `./scripts/rollback.sh <versión>` y luego a la actual.
- [ ] Sección 6.3: respaldar y restaurar en una base local de prueba.

Ejecutó: __________ · Fecha: __________ · Desvíos encontrados: __________
