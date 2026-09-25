#!/bin/bash
# Boots ephemeral, isolated Postgres/Redis test containers, applies
# migrations, runs the Jest/Supertest integration suite, then always tears
# the containers (and their volumes) back down.
set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

cleanup() {
  echo "[test-e2e] Tearing down test infrastructure..."
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

echo "[test-e2e] Starting ephemeral Postgres/Redis..."
docker compose -f "$COMPOSE_FILE" up -d --wait

export NODE_ENV=test
export DATABASE_URL="postgresql://linksphere_test:linksphere_test_pw@localhost:5433/linksphere_test?schema=public"
export REDIS_HOST=localhost
export REDIS_PORT=6380
export JWT_SECRET="test_only_jwt_secret_do_not_use_in_prod_0001"
export WEBHOOK_SIGNING_SECRET="test_only_webhook_secret_do_not_use_prod_01"
# Tight limits so the rate-limit test runs in well under a second instead of
# waiting on the production 30-req/60s window.
export RATE_LIMIT_MAX=5
export RATE_LIMIT_WINDOW_SECONDS=5
export STREAM_CACHE_TTL_SECONDS=2
export MEDIA_QUEUE_JOB_ATTEMPTS=3
export MEDIA_QUEUE_BACKOFF_MS=200

echo "[test-e2e] Applying migrations to test database..."
npx prisma migrate deploy

echo "[test-e2e] Running Jest e2e suite..."
npx jest --config ./test/jest-e2e.json --runInBand "$@"
