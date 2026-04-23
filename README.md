# diesel-dashboard

Hemut Diesel dashboard application repository. It now contains both the
frontend shell and the Python backend that powers integrations, polling jobs,
ingestion into Supabase, and API endpoints.

---

## Overview

One repository, one Vercel project target:

- Next.js frontend served from `/`
- FastAPI backend served from `/api/*`
- Supabase as the system of record

External scheduling infrastructure can still call the backend's internal job
endpoints when needed.

---

## Runbook

### Prereqs
- Python 3.11+
- A Supabase project (URL, anon key, service-role key)
- An EDS bearer token (from Enterprise Diesel)

### Setup
```bash
cp .env.example .env
# fill in SUPABASE_*, EDS_*, INTERNAL_JOB_TOKEN
```

### Apply the DB schema (once)
Run `backend/migrations/001_eds_polling.sql` in the Supabase SQL editor, or:
```bash
psql "$SUPABASE_DB_URL" -f backend/migrations/001_eds_polling.sql
```

### Run the backend locally
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
- Health: `GET /health`  &nbsp;&nbsp;|  Readiness: `GET /ready`
- OpenAPI docs: `http://localhost:8000/docs`

### Run the frontend locally
```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:3000`.

### Trigger a poll manually (dev)
```bash
export TOKEN=$(grep INTERNAL_JOB_TOKEN .env | cut -d= -f2)

curl -X POST http://localhost:8000/internal/jobs/ping \
  -H "Authorization: Bearer $TOKEN"

curl -X POST "http://localhost:8000/internal/jobs/poll-transactions?window_days=3" \
  -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:8000/internal/jobs/poll-accounts \
  -H "Authorization: Bearer $TOKEN"
```

### Tests
```bash
cd backend
pytest
```

---

## Architecture

```
app/
  main.py                       # FastAPI app, CORS, middleware, lifespan, routers
  core/
    config.py                   # Pydantic Settings (env-driven, cached)
    logging.py
    errors.py                   # AppError / IntegrationError / DomainRuleError + handlers
  clients/
    supabase_client.py          # supabase-py service-role client (singleton)
    eds_client.py               # Typed async httpx client for EDS (one method per endpoint)
  repositories/
    eds_repo.py                 # Raw + normalized upserts, poll-run audit
  services/
    eds_normalize.py            # Pure: raw JSON -> typed rows
    eds_poll_service.py         # Orchestrates one poll per endpoint
    fuel_efficiency_service.py  # Example dashboard calculation
  schemas/
    common.py
    calculation_models.py
    eds_models.py               # PollRunResult etc.
  routers/
    health_routes.py            # /, /health, /ready
    calculation_routes.py       # /calculations/*
    internal_jobs.py            # /internal/jobs/*  (auth-gated)
  auth/
    internal_auth.py            # Shared-secret OR Google OIDC verifier
  middleware/
    request_id.py               # X-Request-ID on every request/response
  utils/
migrations/
  001_eds_polling.sql           # Supabase schema (raw + normalized + poll_runs)
tests/
```

## Vercel project shape

This repo is being reworked toward a single Vercel project rooted at `/`.

- Next.js frontend lives under `pages/` and `styles/`
- Python backend entrypoints live under `api/`
- The existing FastAPI application code remains under `app/`

In the deployed single-project Vercel shape, backend routes are exposed under
`/api/*`. For example:

- `GET /api`
- `GET /api/health`
- `GET /api/ready`
- `POST /api/calculations/fuel-efficiency`
- `POST /api/internal/jobs/poll-transactions`

Data flow for a polling job:

```
External Scheduler --OIDC/secret--> Vercel /api/internal/jobs/poll-*
                                           |
                                           v
                                 EDSPollService.poll_X()
                                    |            |
                                    v            v
                              EDSClient     EDSRepo (Supabase)
                                    |            |
                                    v            v
                              EDS REST API   eds_raw_*  +  normalized tables
                                             + eds_raw_poll_runs (audit)
```

### Key decisions

| Decision | Why |
|---|---|
| Monolith, not microservices | One team, one deploy, one codebase. |
| Poll from FastAPI (not `pg_cron`) | Polling logic is list-then-detail + rolling-window + line-item flattening + GeoJSON parsing. SQL is the wrong language for that; Python has retries, Pydantic, mocks, tests. |
| Raw `jsonb` layer + normalized tables | Decouples ingestion from schema evolution. If EDS adds a field, we already have it — normalize later, no re-poll. |
| Cloud Scheduler + shared-secret OR OIDC | Two accepted credentials. Dev uses header token, prod uses Google-signed OIDC. |
| `supabase-py` with service-role key | Backend-only writes bypass RLS. User-scoped reads (future) should use per-request anon client + user JWT. |

---

## API

### Public

| Method | Path | Description |
|---|---|---|
| GET | `/api` | Service info |
| GET | `/api/health` | Liveness (no I/O) |
| GET | `/api/ready` | Readiness (checks Supabase) |
| POST | `/api/calculations/fuel-efficiency` | mpg (+ duration) for a trip |

### Internal (auth-gated, called by Cloud Scheduler)

All require `Authorization: Bearer <token>` — either `INTERNAL_JOB_TOKEN` (shared
secret) or a Google-signed OIDC ID token with audience `INTERNAL_JOB_OIDC_AUDIENCE`.

| Method | Path | Description |
|---|---|---|
| POST | `/api/internal/jobs/ping` | Validates EDS connectivity + partner info |
| POST | `/api/internal/jobs/poll-accounts` | Full dump of `/getAccounts` -> accounts |
| POST | `/api/internal/jobs/poll-drivers` | Full dump of `/getDrivers` -> drivers |
| POST | `/api/internal/jobs/poll-transactions?window_days=3` | Rolling window -> transactions + line items |
| POST | `/api/internal/jobs/poll-documents` | Full dump of `/getDocuments` -> documents |

For `poll-transactions`, `start_date` and `end_date` (ISO) can be passed for
backfills; they override `window_days`.

---

## Polling cadence (recommended)

| Endpoint | Schedule | Strategy |
|---|---|---|
| `/api/internal/jobs/ping` | every 3 hours | Liveness — alert on 5xx / 401 |
| `/api/internal/jobs/poll-transactions` | every 3 hours | Rolling 3-day window; upserts by `transactionID`. Catches back-dated postings. |
| `/api/internal/jobs/poll-accounts` | every 3 hours | Full dump; upsert by `accountToken` |
| `/api/internal/jobs/poll-drivers` | every 3 hours | Full dump; upsert by `driverToken` |
| `/api/internal/jobs/poll-documents` | every 3 hours | Full dump; upsert by `docToken` |

Detail endpoints (`/getAccount/{token}`, `/getDriver/{token}`,
`/getDocument/{token}`) are **not** polled on a schedule. Call them
on-demand — the `EDSClient` methods exist (`get_account`, `get_driver`,
`get_document`) but aren't wired to scheduler jobs.

---

## Cloud Scheduler setup (GCP)

This remains a valid option if you want Google Cloud Scheduler to call the
backend routes inside the Vercel-hosted app.

Two options for auth:

### Option 1 — Shared secret (simplest)
1. Set `INTERNAL_JOB_TOKEN` as a secret in **Google Secret Manager**, mount
   it as an env var in the deployed application.
2. In Cloud Scheduler, create an HTTP job:
   - **Target:** HTTP, `POST`
   - **URL:** `https://<your-app-domain>/api/internal/jobs/poll-transactions`
   - **Auth header:** `Add header` → `Authorization: Bearer <INTERNAL_JOB_TOKEN>`
     *(Scheduler supports an "Auth header" field — use that, don't paste the secret in "body".)*

### Option 2 — Google OIDC (recommended for prod)
1. Create a service account, e.g. `cloud-scheduler@PROJECT.iam.gserviceaccount.com`.
2. Configure the scheduler job to send an OIDC token for the backend target URL.
3. Set on the backend:
   - `INTERNAL_JOB_OIDC_AUDIENCE` = the deployed backend audience value, usually your app URL or an explicit audience string.
   - `INTERNAL_JOB_OIDC_SERVICE_ACCOUNT_EMAIL` = the scheduler SA email (optional — pins the caller).
4. In Cloud Scheduler, create the job with **Auth → Add OIDC token**, pick the
   SA, and set the same audience.

### Example `gcloud` job (shared-secret flavor)
```bash
gcloud scheduler jobs create http eds-poll-transactions \
  --location us-central1 \
  --schedule "*/10 * * * *" \
  --http-method POST \
  --uri "https://your-app-domain.vercel.app/api/internal/jobs/poll-transactions" \
  --headers "Authorization=Bearer ${INTERNAL_JOB_TOKEN}" \
  --attempt-deadline 540s
```

### Why not `pg_cron`?
We considered running jobs inside Supabase via `pg_cron` + `pg_net`. The
polling logic here has rolling windows, dedupe by id, line-item flattening,
and GeoJSON parsing — all painful in PL/pgSQL. `pg_cron` is still the right
tool for **Supabase-internal maintenance** (e.g., materialized-view refreshes,
retention cleanup) — just not for calling external APIs.

---

## CI/CD

The target deployment flow for this repo is Vercel Git integration:

- every pull request gets a Vercel preview deployment
- every merge to `main` gets a production deployment
- GitHub Actions remains useful for repo-level checks such as linting and tests

### Workflow overview

```
PR / push
  └─ GitHub Actions: repo checks
  └─ Vercel: preview deployment for PRs
       └─ (main only) production deployment
```

### Vercel project setup

1. Import this repository into Vercel as a single project rooted at `/`.
2. Leave framework detection on Next.js defaults.
3. Set production branch to `main`.
4. Configure the required environment variables in Vercel for Preview and Production.

App secrets (`SUPABASE_*`, `EDS_API_BEARER_TOKEN`, internal job auth values)
should live in Vercel project environment variables, not in GitHub secrets.

### CORS

Set `CORS_ORIGINS` in the deployed environment to include your production app
domain:

```bash
CORS_ORIGINS=https://your-app-domain.vercel.app
```

---

## Database schema

See `migrations/001_eds_polling.sql`. Summary:

**Raw (ground truth):**
- `eds_raw_poll_runs` — audit row per polling run (endpoint, started_at, status, row_count, error, meta).
- `eds_raw_accounts`, `eds_raw_drivers`, `eds_raw_transactions`, `eds_raw_documents`
  — full JSON blob per natural key with `polled_at`.

**Normalized (what the dashboard queries):**
- `accounts` — typed columns; nested `primary_user`, `account_manager`,
  `sales_person` kept as `jsonb`.
- `drivers` — includes `cdl_expiration` for expiry dashboards.
- `transactions` + `transaction_line_items` — parent/child. GeoJSON station
  coordinates unpacked into `station_latitude` / `station_longitude`.
- `documents` — status + company + contract dates.

RLS is **enabled with no public policies** on every table. Only the service
role (used by this backend) can read/write. Add policies later when the
dashboard needs row-scoped reads.

---

## Testing

```bash
pytest                                   # all
pytest tests/test_eds_normalize.py -v    # pure normalizer tests (no network)
pytest tests/test_internal_auth.py -v    # auth dependency tests
```

Pure services (`eds_normalize`, `fuel_efficiency_service`) are tested directly.
Repo/client tests against a real Supabase test project are TODO — add when
needed.

---

## Operations

- **Logs:** stdout, structured line format, `X-Request-ID` on every response.
- **Health:** `/health` (liveness), `/ready` (readiness with Supabase check).
- **Errors:** uniform envelope from `app/core/errors.py`:
  `{"error": {"code", "message", "request_id?"}}`.
- **Poll audit:** query `eds_raw_poll_runs` for recent runs per endpoint:
  ```sql
  select endpoint, started_at, ended_at, status, row_count, error
    from public.eds_raw_poll_runs
   order by started_at desc limit 50;
  ```
