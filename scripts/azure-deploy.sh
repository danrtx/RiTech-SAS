#!/usr/bin/env bash
set -euo pipefail

# ─── Configuración ──────────────────────────────────────────────
RESOURCE_GROUP="ritech-rg"
LOCATION="northcentralus"
ACR_NAME="ritechacr$(openssl rand -hex 3)"
CONTAINER_ENV="ritech-env"
CONTAINER_APP="ritech-backend"
PG_SERVER_NAME="ritech-pg-$(openssl rand -hex 3)"
PG_ADMIN_USER="ritechadmin"
PG_ADMIN_PASS="RiTech$(openssl rand -hex 8)!"
PG_DB_NAME="ritech"

REDIS_HOST="${UPSTASH_REDIS_HOST:-}"
REDIS_PORT="${UPSTASH_REDIS_PORT:-6379}"
REDIS_PASS="${UPSTASH_REDIS_PASSWORD:-}"

# ─── Validaciones ───────────────────────────────────────────────
if [ -z "$REDIS_HOST" ] || [ -z "$REDIS_PASS" ]; then
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  Exporta las variables de Upstash antes de continuar:   ║"
  echo "║     export UPSTASH_REDIS_HOST=...                       ║"
  echo "║     export UPSTASH_REDIS_PORT=...                       ║"
  echo "║     export UPSTASH_REDIS_PASSWORD=...                   ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  exit 1
fi

echo "==> Verificando sesión de Azure..."
if ! az account show >/dev/null 2>&1; then
  echo "No estás logueado. Ejecuta: az login"
  exit 1
fi
SUBSCRIPTION=$(az account show --query name -o tsv)
echo "    Suscripción: $SUBSCRIPTION"

# ─── Registrar proveedores necesarios ───────────────────────────
echo "==> Registrando proveedores de Azure..."
for ns in Microsoft.DBforPostgreSQL Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry; do
  az provider register --namespace "$ns" -o none 2>/dev/null || true
done
echo "    Esperando registro..."
for ns in Microsoft.DBforPostgreSQL Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry; do
  while [ "$(az provider show --namespace "$ns" --query registrationState -o tsv 2>/dev/null)" != "Registered" ]; do
    sleep 5
  done
done
echo "    Proveedores listos."

# ─── 1. Grupo de recursos ──────────────────────────────────────
echo "==> Creando grupo de recursos: $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o none

# ─── 2. Azure Container Registry ───────────────────────────────
echo "==> Creando Container Registry: $ACR_NAME"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --location "$LOCATION" \
  --admin-enabled true \
  -o none

ACR_SERVER="${ACR_NAME}.azurecr.io"

# ─── 3. Construir y subir imagen Docker ────────────────────────
echo "==> Construyendo imagen Docker (linux/amd64)..."
docker build --platform linux/amd64 \
  -t "${ACR_SERVER}/ritech-backend:latest" \
  backend/

echo "==> Subiendo imagen a ACR..."
az acr login --name "$ACR_NAME"
docker push "${ACR_SERVER}/ritech-backend:latest"

# ─── 4. PostgreSQL Flexible Server ─────────────────────────────
echo "==> Creando PostgreSQL Flexible Server: $PG_SERVER_NAME"
az postgres flexible-server create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PG_SERVER_NAME" \
  --location "$LOCATION" \
  --admin-user "$PG_ADMIN_USER" \
  --admin-password "$PG_ADMIN_PASS" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --public-access 0.0.0.0 \
  --yes \
  -o none

echo "==> Creando base de datos: $PG_DB_NAME"
az postgres flexible-server db create \
  --resource-group "$RESOURCE_GROUP" \
  --server-name "$PG_SERVER_NAME" \
  -n "$PG_DB_NAME" \
  -o none

PG_HOST="${PG_SERVER_NAME}.postgres.database.azure.com"

# ─── 5. Container Apps Environment ─────────────────────────────
echo "==> Creando Container Apps Environment..."
az containerapp env create \
  --name "$CONTAINER_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  -o none

# ─── 6. Container App ──────────────────────────────────────────
ACR_USER=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_CRED=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

echo "==> Desplegando Container App..."
az containerapp create \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$CONTAINER_ENV" \
  --image "${ACR_SERVER}/ritech-backend:latest" \
  --registry-server "$ACR_SERVER" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_CRED" \
  --target-port 3000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1Gi \
  --secrets db-password="$PG_ADMIN_PASS" redis-password="$REDIS_PASS" \
  --env-vars \
    NODE_ENV=production \
    PORT=3000 \
    DB_HOST="$PG_HOST" \
    DB_PORT=5432 \
    DB_USER="$PG_ADMIN_USER" \
    DB_PASSWORD=secretref:db-password \
    DB_NAME="$PG_DB_NAME" \
    REDIS_HOST="$REDIS_HOST" \
    REDIS_PORT="$REDIS_PORT" \
    REDIS_PASSWORD=secretref:redis-password \
    MARKET_DATA_ENABLED=false \
    FCM_ENABLED=false \
  -o none

# ─── 7. Verificar despliegue ───────────────────────────────────
APP_FQDN=$(az containerapp show \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)
APP_URL="https://${APP_FQDN}"

echo "==> Esperando que la app arranque (max 120s)..."
SECONDS=0
until curl -sf "${APP_URL}/health/live" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge 120 ]; then
    echo "AVISO: La app aún no responde. Puede tardar unos minutos más."
    echo "       Verifica en: ${APP_URL}/health"
    break
  fi
  sleep 5
done

if curl -sf "${APP_URL}/health/live" >/dev/null 2>&1; then
  echo "==> App respondiendo correctamente!"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  DESPLIEGUE COMPLETADO                                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "  App URL:    $APP_URL"
echo "  Health:     $APP_URL/health"
echo "  PostgreSQL: $PG_HOST"
echo "  PG User:    $PG_ADMIN_USER"
echo "  PG Pass:    $PG_ADMIN_PASS"
echo "  PG DB:      $PG_DB_NAME"
echo "  Redis:      $REDIS_HOST:$REDIS_PORT"
echo "  ACR:        $ACR_SERVER"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "IMPORTANTE: Guarda las credenciales de PostgreSQL."
echo ""
echo "Logs:        az containerapp logs show -n $CONTAINER_APP -g $RESOURCE_GROUP"
echo "Reiniciar:   az containerapp revision restart -n $CONTAINER_APP -g $RESOURCE_GROUP"
echo "Eliminar:    az group delete -n $RESOURCE_GROUP --yes --no-wait"
