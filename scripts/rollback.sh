#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"

if [ -n "${1:-}" ]; then
  ROLLBACK_TAG="$1"
elif [ -f .last-deploy-tag ]; then
  ROLLBACK_TAG=$(cat .last-deploy-tag)
else
  echo "ERROR: No se encontró tag anterior. Usa: ./scripts/rollback.sh <tag>"
  exit 1
fi

if [ "$ROLLBACK_TAG" = "none" ]; then
  echo "ERROR: No hay despliegue anterior registrado."
  exit 1
fi

echo "==> Rollback a ritech-backend:$ROLLBACK_TAG"

if ! docker image inspect "ritech-backend:$ROLLBACK_TAG" >/dev/null 2>&1; then
  echo "ERROR: La imagen ritech-backend:$ROLLBACK_TAG no existe localmente."
  echo "       Reconstruye con: DEPLOY_TAG=$ROLLBACK_TAG docker compose -f $COMPOSE_FILE build backend"
  exit 1
fi

export DEPLOY_TAG="$ROLLBACK_TAG"
docker compose -f "$COMPOSE_FILE" up -d --no-deps backend

echo "==> Esperando health check (max 60s)..."
SECONDS=0
until docker inspect --format='{{.State.Health.Status}}' ritech-prod-backend 2>/dev/null | grep -q "healthy"; do
  if [ "$SECONDS" -ge 60 ]; then
    echo "ERROR: Health check falló tras rollback. Revisar logs:"
    echo "       docker logs ritech-prod-backend --tail 50"
    exit 1
  fi
  sleep 2
done

echo "==> Rollback exitoso. Backend healthy con tag $ROLLBACK_TAG"
