#!/usr/bin/env bash
set -euo pipefail

# ─── Configuración ──────────────────────────────────────────────
RESOURCE_GROUP="ritech-rg"
LOCATION="eastus"
ACR_NAME="ritechacr$(openssl rand -hex 3)"
CONTAINER_APP_ENV="ritech-env"
CONTAINER_APP_NAME="ritech-backend"
PG_SERVER_NAME="ritech-pg-$(openssl rand -hex 3)"
PG_ADMIN_USER="ritechadmin"
PG_ADMIN_PASS="RiTech$(openssl rand -hex 8)!"
PG_DB_NAME="ritech"
IMAGE_NAME="ritech-backend"
IMAGE_TAG="v1"

# Redis: Upstash (gratis). Configura estas variables antes de correr.
REDIS_HOST="${UPSTASH_REDIS_HOST:-}"
REDIS_PORT="${UPSTASH_REDIS_PORT:-6379}"
REDIS_PASS="${UPSTASH_REDIS_PASSWORD:-}"

# ─── Validaciones ───────────────────────────────────────────────
if [ -z "$REDIS_HOST" ] || [ -z "$REDIS_PASS" ]; then
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  ANTES DE CONTINUAR: crea una base Redis en Upstash     ║"
  echo "║  1. Ve a https://console.upstash.com                    ║"
  echo "║  2. Crea una base Redis (región: US East 1)             ║"
  echo "║  3. Copia el host, port y password                      ║"
  echo "║  4. Exporta las variables:                              ║"
  echo "║     export UPSTASH_REDIS_HOST=...                       ║"
  echo "║     export UPSTASH_REDIS_PORT=...                       ║"
  echo "║     export UPSTASH_REDIS_PASSWORD=...                   ║"
  echo "║  5. Vuelve a correr este script                         ║"
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

# ─── 1. Grupo de recursos ──────────────────────────────────────
echo "==> Creando grupo de recursos: $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o none

# ─── 2. Azure Container Registry ───────────────────────────────
echo "==> Creando Container Registry: $ACR_NAME"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled true \
  -o none

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

# ─── 3. Construir y subir imagen ───────────────────────────────
echo "==> Construyendo imagen Docker en ACR..."
az acr build \
  --registry "$ACR_NAME" \
  --image "$IMAGE_NAME:$IMAGE_TAG" \
  --file backend/Dockerfile \
  backend/

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
  --yes \
  -o none

echo "==> Creando base de datos: $PG_DB_NAME"
az postgres flexible-server db create \
  --resource-group "$RESOURCE_GROUP" \
  --server-name "$PG_SERVER_NAME" \
  --database-name "$PG_DB_NAME" \
  -o none

echo "==> Permitiendo acceso desde servicios Azure..."
az postgres flexible-server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PG_SERVER_NAME" \
  --rule-name AllowAzure \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  -o none

PG_HOST="${PG_SERVER_NAME}.postgres.database.azure.com"

# ─── 5. Container Apps Environment ─────────────────────────────
echo "==> Creando Container Apps environment: $CONTAINER_APP_ENV"
az containerapp env create \
  --name "$CONTAINER_APP_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  -o none

# ─── 6. Desplegar Container App ────────────────────────────────
echo "==> Desplegando Container App: $CONTAINER_APP_NAME"
az containerapp create \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$CONTAINER_APP_ENV" \
  --image "$ACR_LOGIN_SERVER/$IMAGE_NAME:$IMAGE_TAG" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-username "$ACR_NAME" \
  --registry-password "$ACR_PASSWORD" \
  --target-port 3000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 2 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --env-vars \
    "NODE_ENV=production" \
    "PORT=3000" \
    "DB_HOST=$PG_HOST" \
    "DB_PORT=5432" \
    "DB_USER=$PG_ADMIN_USER" \
    "DB_PASSWORD=$PG_ADMIN_PASS" \
    "DB_NAME=$PG_DB_NAME" \
    "REDIS_HOST=$REDIS_HOST" \
    "REDIS_PORT=$REDIS_PORT" \
    "REDIS_PASSWORD=$REDIS_PASS" \
    "MARKET_DATA_ENABLED=false" \
    "FCM_ENABLED=false" \
  -o none

# ─── 7. Obtener URL ────────────────────────────────────────────
APP_URL=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" \
  -o tsv)

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  DESPLIEGUE EXITOSO                                     ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "  App URL:    https://$APP_URL"
echo "  Health:     https://$APP_URL/health"
echo "  PostgreSQL: $PG_HOST"
echo "  PG User:    $PG_ADMIN_USER"
echo "  PG Pass:    $PG_ADMIN_PASS"
echo "  Redis:      $REDIS_HOST:$REDIS_PORT"
echo "  ACR:        $ACR_LOGIN_SERVER"
echo "  Imagen:     $ACR_LOGIN_SERVER/$IMAGE_NAME:$IMAGE_TAG"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "IMPORTANTE: Guarda las credenciales de PostgreSQL en un lugar seguro."
echo ""
echo "Para ver logs:    az containerapp logs show -n $CONTAINER_APP_NAME -g $RESOURCE_GROUP --follow"
echo "Para rollback:    az containerapp update -n $CONTAINER_APP_NAME -g $RESOURCE_GROUP --image $ACR_LOGIN_SERVER/$IMAGE_NAME:<tag-anterior>"
echo "Para eliminar:    az group delete -n $RESOURCE_GROUP --yes --no-wait"
