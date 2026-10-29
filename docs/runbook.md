# Face pipeline runbook

## Services

| Process | Command | Role |
|---|---|---|
| API | `node src/index.js` | Stateless HTTP, presigns, enqueue |
| Worker | `node src/worker.js` | Derivatives, index, search, delete, cleanup |
| Postgres | RDS / docker | Source of truth |
| Redis | ElastiCache / docker | BullMQ |
| S3 | private bucket | Originals, derivatives, temp selfies |
| Rekognition | collection per env | Face vectors only |

Compose: `docker compose up` starts API + **worker** + redis + postgres.

## Health

- `GET /health/live` — process up  
- `GET /health/ready` — DB + Redis  
- `GET /metrics` — Prometheus (optional `x-metrics-token`)

## Failed indexing recovery

1. Admin → gallery → **Reindex** (`POST /api/admin/galleries/:id/reindex`)  
2. Or `npm run reconcile --fix` to re-enqueue stuck `UPLOADED/QUEUED/PROCESSING` photos  
3. Worker boot runs `recoverStuck()` automatically  

## Queue backlog

Symptoms: rising `photos` in `PROCESSING`, gallery `faceIndexStatus=RUNNING` for hours.

Checks:

```bash
# Redis queue depths (BullMQ keys)
redis-cli LLEN bull:derivatives:wait
redis-cli LLEN bull:face-index:wait
redis-cli LLEN bull:face-search:wait
```

Actions:

- Scale worker replicas (`WORKER_CONCURRENCY_FACE`, `REKOGNITION_*_TPS`)  
- Confirm Redis connectivity  
- Watch for `ThrottlingException` → lower TPS or request quota increase  

## Throttling

BullMQ limiter defaults to 5 TPS per index/search worker.  
`ThrottlingException` is **retryable** (exponential backoff, 3 attempts).  
Exhausted jobs → `DEAD_LETTER` in `ProcessingJob`.

## DLQ replay

1. `GET /api/admin/jobs?status=DEAD_LETTER`  
2. Inspect `lastErrorCode` / `lastErrorMessageSafe` (safe only)  
3. `POST /api/admin/jobs/:id/replay`  

Admin UI: **Jobs** page.

## Reconciliation

```bash
cd backend && npm run reconcile          # report
cd backend && npm run reconcile -- --fix # re-enqueue stuck + missing derivatives
```

## Cost spike response

1. Check metrics: `rekognition_calls_total`, `faces_indexed_total`  
2. Look for accidental reindex loops (idempotency keys should prevent double index)  
3. Disable face search on galleries not needing it  
4. Confirm no client is hammering search (rate limit 5/customer/hour)

## Incident checklist

- [ ] `/health/ready` green  
- [ ] Worker logs show no crash loop  
- [ ] Redis reachable  
- [ ] S3 permissions (worker RW; API presign)  
- [ ] Rekognition collection exists (`ensureCollection` is idempotent)  
- [ ] No selfie prefixes older than 24h under `temporary-face-search/`  
- [ ] DLQ empty or triaged  
- [ ] Customer communication: no identity claims, offer re-selfie  

## Config keys

See `backend/.env.example` — especially `REKOGNITION_MODE`, `REKOGNITION_COLLECTION_ID`, `FACE_MATCH_THRESHOLD`, `FACE_BROADER_THRESHOLD`, `REDIS_URL`, worker concurrency, TPS caps.
