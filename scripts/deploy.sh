#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
TAG="${1:-latest}"

export DEPLOY_TAG="$TAG"

echo "==> Construyendo imagen ritech-backend:$TAG"
docker compose -f "$COMPOSE_FILE" build backend

echo "==> Guardando tag anterior para rollback"
PREV_TAG=$(docker inspect --format='{{index .Config.Labels "deploy.tag"}}' ritech-prod-backend 2>/dev/null || echo "none")
echo "$PREV_TAG" > .last-deploy-tag

echo "==> Desplegando con tag $TAG"
docker compose -f "$COMPOSE_FILE" up -d --no-deps backend

echo "==> Esperando health check (max 60s)..."
SECONDS=0
until docker inspect --format='{{.State.Health.Status}}' ritech-prod-backend 2>/dev/null | grep -q "healthy"; do
  if [ "$SECONDS" -ge 60 ]; then
    echo "ERROR: Health check no pasó en 60s. Ejecuta ./scripts/rollback.sh para revertir."
    exit 1
  fi
  sleep 2
done

echo "==> Despliegue exitoso. Backend healthy con tag $TAG"
