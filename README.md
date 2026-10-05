# RiTech SAS

Plataforma de cobertura (hedging) sobre el NASDAQ 100: backend NestJS (monolito modular) y app móvil Flutter.

## Motor ATR de un minuto

El [motor operativo NestJS](backend/README.md) lee ticks de Redis, construye velas UTC, calcula ATR Wilder y publica resultados/alertas por Socket.IO y `GET /atr`. Flutter consume estos eventos y muestra ATR/baseline. Incluye pruebas con Redis real, proveedor simulado, reconexión y referencia pandas. El conector del proveedor de mercado real sigue pendiente de integración por el equipo.

Se conserva [packages/atr_engine](packages/atr_engine/README.md) como biblioteca Dart independiente y referencia de pruebas; su [adaptador Flutter](packages/atr_engine_flutter/README.md) es opcional. El dashboard operativo usa el ATR del backend.

## Infraestructura local (PostgreSQL + Redis)

El backend usa **PostgreSQL 16** para persistencia y **Redis 7** como caché de ticks y ventana móvil del ATR. La app Flutter no se conecta a estos servicios directamente: siempre pasa por el backend.

### Requisitos

- Docker Desktop abierto (incluye Docker Compose v2).

### Levantar los servicios

```bash
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
docker compose up -d
docker compose ps           # ambos servicios deben aparecer como "healthy"
```

Para verificar todo de una vez en Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verificar-infra.ps1
```

### Puertos y credenciales de desarrollo

| Servicio   | Host        | Puerto | Usuario  | Contraseña   | Base de datos |
|------------|-------------|--------|----------|--------------|---------------|
| PostgreSQL | localhost   | 5433   | ritech   | ritech_dev   | ritech        |
| Redis      | localhost   | 6379   | (n/a)    | ritech_dev   | db 0          |

Estas credenciales son solo para desarrollo local. PostgreSQL usa el puerto 5433 en tu máquina (no el 5432 por defecto) para no chocar con otras instalaciones de PostgreSQL. Si aun así un puerto está ocupado (por ejemplo, tienes PostgreSQL instalado en Windows), cambia `POSTGRES_PORT` o `REDIS_PORT` en `.env` y actualiza también `DB_PORT`, `DATABASE_URL` y `REDIS_URL`.

### Conexión desde el backend (NestJS)

El backend lee la conexión desde variables de entorno definidas en `.env`:

- PostgreSQL: `DATABASE_URL` o `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- Redis: `REDIS_URL` o `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

Nunca escribas credenciales directamente en el código. `.env` está en `.gitignore`; solo se versiona `.env.example`.

### Conectarse manualmente

```bash
docker compose exec postgres psql -U ritech -d ritech
docker compose exec redis redis-cli -a ritech_dev
```

### Persistencia

- PostgreSQL guarda sus datos en el volumen `ritech_postgres_data`.
- Redis guarda su caché en el volumen `ritech_redis_data` (AOF activado), así que sobrevive a reinicios.
- `docker compose down` detiene los contenedores **sin borrar** los datos.

### Limpieza

```bash
docker compose down         # detener (conserva datos)
docker compose down -v      # detener y BORRAR todos los datos (base limpia)
docker compose logs -f      # ver logs si algo falla
```

## Integración continua (CI)

Cada pull request hacia `main` (y cada push a `main`) ejecuta el workflow `.github/workflows/ci.yml` en GitHub Actions con tres trabajos:

| Trabajo | Qué valida |
|---------|------------|
| **Backend (NestJS)** | ESLint, Jest, compilación y pruebas con Redis real/reconexión simulada |
| **App móvil (Flutter)** | `flutter analyze` y pruebas unitarias con `flutter test` |
| **Paquetes ATR** | Análisis, pruebas y formato del núcleo Dart y su adaptador Flutter |

Si cualquiera de los dos falla, el PR queda marcado en rojo y no debe unirse a `main`. Los resultados se ven en la pestaña **Checks** del PR o en **Actions** del repositorio.

### Correr las mismas validaciones en local

Antes de abrir un PR, ejecuta lo mismo que corre el CI:

```bash
# Backend
cd backend
npm ci
npm run lint        # npm run lint:fix corrige lo automático
npm test
npm run build

# App móvil
cd ../frontend_mobile
flutter pub get
flutter analyze --no-fatal-infos
flutter test
```

Las pruebas del backend van junto al código con el sufijo `.spec.ts` (por ejemplo `src/modules/health/health.controller.spec.ts`). Las de Flutter van en `frontend_mobile/test/` con el sufijo `_test.dart`.
