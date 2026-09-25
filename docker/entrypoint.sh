#!/bin/sh
set -e

# Only the `app` service sets RUN_MIGRATIONS=true in docker-compose.yml, so a
# concurrently-starting `worker` container never races it. `prisma migrate
# deploy` is itself safe to re-run (idempotent, tracks applied migrations).
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[entrypoint] Applying database migrations..."

  attempt=0
  max_attempts=30
  until npx prisma migrate deploy; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "[entrypoint] Migrations failed after ${max_attempts} attempts" >&2
      exit 1
    fi
    echo "[entrypoint] Migration attempt ${attempt} failed, retrying in 2s..."
    sleep 2
  done
  echo "[entrypoint] Migrations applied."

  if [ "$SEED_DATABASE" = "true" ]; then
    echo "[entrypoint] Seeding database..."
    node prisma/seed.js
  fi
fi

exec "$@"
