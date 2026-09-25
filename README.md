# Linksphere Backend — Senior Backend & DevOps Assessment

A resilient, containerized NestJS backend prototype for an interactive social/media platform: idempotent payment webhook ingestion, authenticated + rate-limited stream access, and an asynchronous media moderation pipeline.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | NestJS 10 (TypeScript, strict) |
| Database | PostgreSQL 15 via Prisma ORM |
| Cache / locks / rate limiting | Redis 7 (ioredis) |
| Background jobs | BullMQ (Redis-backed queue) |
| Auth | JWT (Bearer) via Passport |
| Containerization | Docker + Docker Compose |
| Tests | Jest + Supertest (real Postgres/Redis, no mocks) |

## Architecture

```
                    ┌─────────────┐
   HTTP clients ───▶│   app (API) │──┐
                    └─────────────┘  │
                            │        │  BullMQ jobs (Redis-backed)
                            ▼        ▼
                    ┌─────────────┐  ┌──────────────┐
                    │  PostgreSQL │  │    Redis     │
                    └─────────────┘  └──────────────┘
                            ▲        ▲
                            │        │  consumes jobs
                    ┌─────────────────────┐
                    │  worker (isolated)  │
                    └─────────────────────┘
```

- **`app`** — the HTTP API (`src/main.ts` → `AppModule`). Handles auth, the payment webhook, rate-limited stream reads, and *enqueues* media moderation jobs. It never runs the heavy moderation work itself.
- **`worker`** — a fully separate Node process (`src/worker.ts` → `WorkerModule`), with no HTTP server, that consumes the BullMQ queue and runs the simulated transcoding/keyframe-analysis workload. This keeps compute-heavy work off the request-response thread.
- Both processes share the same PostgreSQL and Redis instances but are independently deployable/scalable containers.

### Module layout (`src/modules/*`)

- **`auth`** — JWT issuing/validation. `POST /api/v1/auth/token` is a *test/simulation helper* (documented below) that mints a bearer token for a seeded user, since a full login/signup flow is out of scope for this assessment.
- **`payments`** — Module A: idempotent webhook ingestion.
- **`streams`** — Module B: authenticated, rate-limited, cache-aside stream reads.
- **`media`** — Module C: async upload-task intake (producer) + `media.processor.ts` (consumer, loaded only by the `worker` process).
- **`common/redis`** — a small Redis service exposing a distributed lock (`SET NX PX` + token-safe release via Lua) and an atomic sliding-window rate limiter (Lua script over a sorted set), used by both the payments and streams modules.
- **`prisma`** — global Prisma client module/service.

## Module A — Idempotent Payment Webhook (`POST /api/v1/payments/webhook`)

- **Signature verification**: `HmacSignatureGuard` (`src/modules/payments/guards/hmac-signature.guard.ts`) recomputes an HMAC-SHA256 over the *raw* request body (captured via Nest's `rawBody: true` option, so JSON re-serialization can never change the signed bytes) and compares it to the `X-Webhook-Signature` header using `crypto.timingSafeEqual` — a constant-time comparison that prevents timing attacks. A missing/invalid signature returns `401`.
- **Idempotency**: `PaymentsService.handleWebhook` first takes a short-lived Redis lock (`SET NX PX`) keyed by the gateway's `eventId`, as a fast-path to avoid wasted transaction attempts. **The actual correctness guarantee is a Postgres unique constraint** on `processed_webhooks.eventId` (and `transactions.eventId`): the balance increment + ledger insert happen inside a single `$transaction`, and if two requests for the same event ever race past the lock, only one `INSERT` can win — the loser catches the unique-constraint violation (`P2002`) and returns the same `{"status":"duplicate"}` response. This was verified by firing 10 identical concurrent requests at the endpoint: exactly one `processed`, nine `duplicate`, balance credited exactly once.
- **Atomicity**: balance update and ledger (`transactions` table) write happen in one ACID transaction — never separately.
- Replays (whether concurrent or sequential) always return `200 OK`, per gateway-retry conventions; only genuine failures (bad signature, unknown user, invalid payload) return non-2xx.

## Module B — Authenticated, Rate-Limited Streams (`GET /api/v1/streams/active`)

- **Auth**: Bearer JWT validated via Passport (`JwtStrategy`), carrying custom claims `sub` (user id) and `subscriptionTier`.
- **Rate limiting**: `RateLimitGuard` runs a Lua-scripted sliding-window-log algorithm against a Redis sorted set, keyed per authenticated user id. State lives in Redis, not process memory, so it is correct across container restarts and multiple app replicas. Exceeding the limit (default 30 req/min) returns `429` with `Retry-After` (seconds) and `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers.
- **Caching**: cache-aside pattern — `StreamsService` checks Redis first (`streams:active`, TTL 10s); on a miss it reads Postgres and repopulates the cache. Since this endpoint has no corresponding write endpoint in scope, TTL expiry *is* the invalidation mechanism.

## Module C — Async Media Moderation (`POST /api/v1/media/upload-task`)

- The controller only validates the request, writes a `PENDING` `media_tasks` row, and enqueues a BullMQ job (`media.service.ts`) — it returns `202 Accepted` immediately.
- The **isolated worker process** (`src/worker.ts`) consumes the queue and simulates keyframe-analysis/transcoding with a realistic random delay (500–2000ms).
- **Retries**: jobs are configured with `attempts: 3` and exponential backoff (`MEDIA_QUEUE_BACKOFF_MS`, doubling each retry).
- **Dead-letter queue**: once a job exhausts all 3 attempts, `MediaModerationProcessor`'s `failed` event handler updates the task's Postgres row to `FAILED_MODERATION` (with `failReason`) and pushes the job payload onto a genuinely separate `media-moderation-dlq` BullMQ queue.
- For deterministic testing, `POST /api/v1/media/upload-task` accepts an optional `simulateFailure: true` field that forces every attempt to fail — this is a test-only hook (documented, not a real gateway feature) used by the automated suite to exercise the retry → DLQ path without relying on the ambient 15% random-failure simulation.

## Module D — Containerization

- `docker-compose.yml` orchestrates 4 services: `postgres` (15-alpine), `redis` (7-alpine), `app`, and `worker`.
- Healthchecks: `pg_isready` for Postgres, `redis-cli ping` for Redis, and `GET /api/v1/health` (checks both DB and Redis connectivity) for the `app` container. Both `app` and `worker` declare `depends_on: { condition: service_healthy }` on Postgres and Redis, so they never start against a not-yet-ready dependency.
- Migrations run automatically on boot: `docker/entrypoint.sh` runs `prisma migrate deploy` (idempotent, retried with backoff) followed by a database seed, gated by `RUN_MIGRATIONS`/`SEED_DATABASE` env vars that are only set `true` on the `app` service — so two containers never race on first boot.
- All secrets/config are environment-driven; nothing is hardcoded. See `.env.example`.

## Getting started

```bash
cp .env.example .env
# Edit JWT_SECRET and WEBHOOK_SIGNING_SECRET, e.g.:
# openssl rand -hex 32

docker compose up --build
```

This single command builds the images, starts Postgres/Redis, waits for them to be healthy, then starts the API (`http://localhost:3000`) and the worker. Migrations and seed data are applied automatically on first boot.

To reset everything from scratch:

```bash
docker compose down -v && docker compose up --build
```

Seeded users (created by `prisma/seed.js`):

| id | email | tier | starting balance |
|---|---|---|---|
| `11111111-1111-4111-8111-111111111111` | free-user@linksphere.dev | FREE | 0 |
| `22222222-2222-4222-8222-222222222222` | pro-user@linksphere.dev | PRO | 5000 |

## API reference & sample curl commands

A ready-to-import Postman collection is at [`postman/linksphere.postman_collection.json`](postman/linksphere.postman_collection.json).

### 1. Mint a test bearer token

There is no login/signup flow in scope for this assessment; this endpoint simulates what an identity provider would issue after authenticating a seeded user.

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{
        "userId": "11111111-1111-4111-8111-111111111111",
        "email": "free-user@linksphere.dev",
        "subscriptionTier": "FREE"
      }'
# => { "accessToken": "...", "expiresIn": "1h" }
```

### 2. Payment webhook

The signature is `HMAC_SHA256(WEBHOOK_SIGNING_SECRET, rawRequestBody)`, hex-encoded.

```bash
SECRET="<your WEBHOOK_SIGNING_SECRET>"
PAYLOAD='{"eventId":"evt_12345","provider":"stripe","type":"BALANCE_CREDIT","userId":"11111111-1111-4111-8111-111111111111","amountCents":1500}'
SIGNATURE=$(node -e "console.log(require('crypto').createHmac('sha256','$SECRET').update(process.argv[1]).digest('hex'))" "$PAYLOAD")

curl -s -X POST http://localhost:3000/api/v1/payments/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
# => {"status":"processed","eventId":"evt_12345","balanceCents":1500,"subscriptionTier":"FREE"}

# Replaying the exact same request again returns:
# => {"status":"duplicate","eventId":"evt_12345"}
```

Supported `type` values: `BALANCE_CREDIT` (requires `amountCents`) and `SUBSCRIPTION_UPGRADE` (requires `tier`: `FREE` | `BASIC` | `PRO`).

### 3. Active streams (authenticated, rate-limited, cached)

```bash
TOKEN="<accessToken from step 1>"
curl -s http://localhost:3000/api/v1/streams/active -H "Authorization: Bearer $TOKEN"
```

Fire more than 30 requests within 60 seconds and you'll receive:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
```

### 4. Upload a media moderation task

```bash
curl -s -X POST http://localhost:3000/api/v1/media/upload-task \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"videoUrl":"https://cdn.example.com/videos/clip.mp4"}'
# => {"taskId":"...", "status":"PENDING"}

curl -s http://localhost:3000/api/v1/media/tasks/<taskId> -H "Authorization: Bearer $TOKEN"
# => status transitions PENDING -> PROCESSING -> COMPLETED (or FAILED_MODERATION after 3 retries)
```

Pass `"simulateFailure": true` in the upload body to deterministically force the retry → dead-letter-queue path.

## Environment variables

See [`.env.example`](.env.example) for the full list with defaults. Every secret, database URL, and tunable (rate limit, cache TTL, queue retry policy) is environment-driven — nothing is hardcoded in source.

## Running tests

```bash
npm install
npm run test:e2e
```

`npm run test:e2e` (`scripts/test-e2e.sh`) is fully self-contained: it boots **ephemeral** Postgres/Redis containers on non-default ports (`docker-compose.test.yml`, so it never touches your dev stack or data), applies migrations, runs the Jest/Supertest suite, and always tears the containers back down afterward — no manual setup required.

Coverage includes, per the assessment's required minimum:

- **`test/payments.e2e-spec.ts`** — HMAC signature rejection (invalid + missing signature), sequential replay idempotency, and **10 concurrent identical webhook requests** processing exactly once (asserted via both the response bodies and the actual Postgres balance/ledger state).
- **`test/streams.e2e-spec.ts`** — 401 without a token, successful authenticated read, rate-limit enforcement returning `429` with a valid `Retry-After` header once the (test-tightened) limit is exceeded, and confirms limits are tracked per-user.
- **`test/media.e2e-spec.ts`** — validates the DTO, and runs a real in-process worker (the same `MediaModerationProcessor` used in production) to verify a task reaches `COMPLETED`, and that a persistently-failing task retries exactly 3 times before landing in the dead-letter queue as `FAILED_MODERATION`.
- **`test/app.e2e-spec.ts`** — health check.

Unit-level `npm test` also runs (Jest, no infra required) for anything added under `*.spec.ts`.

## Design notes / trade-offs

- **Prisma pinned to 5.22.0 (not latest)**: at the time of writing, `prisma@latest` resolves to an unreleased 8.0.0 release candidate with breaking CLI changes (`migrate` subcommand removed). Pinning avoids `npx prisma migrate deploy` silently fetching an incompatible CLI in a fresh environment — the exact class of bug the assessment's health-check criteria are designed to catch.
- **NestJS 10 (not 12) / Jest (not Vitest)**: the current `@nestjs/cli` scaffolds NestJS 12 on Vitest/ESM by default. The assessment rubric explicitly names Jest/Supertest, so the stable, widely-deployed v10/CommonJS/Jest combination was used instead.
- **`prisma` CLI is a production dependency**, not a dev dependency — it must be present in the runtime image for `entrypoint.sh` to run `prisma migrate deploy` on container boot.
