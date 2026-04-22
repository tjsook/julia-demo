# diesel-dashboard-backend

Backend service for the Hemut Diesel dashboard. Owns server-side integrations
(EDS, HubSpot), scheduled polling jobs, ingestion into Supabase, and the APIs
that power the dashboard.

---

## Overview

FastAPI monolith. One process, one repo, one `app/` package. Deploys as a
single container on **Google Cloud Run**, with **Cloud Scheduler** triggering
the polling endpoints on a schedule.

The repo now also includes a minimal root-level Next.js shell so frontend work
can begin in-place inside a single Vercel project.

---

## Runbook

### Prereqs
- Python 3.11+
- A Supabase project (URL, anon key, service-role key)
- An EDS bearer token (from Enterprise Diesel)

### Setup
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# fill in SUPABASE_*, EDS_*, INTERNAL_JOB_TOKEN
```

The backend reads both root `.env` and root `.env.local` during local
development. If the same variable exists in both files, `.env.local` is the
intended override layer.

### Apply the DB schema (once)
Run `migrations/001_eds_polling.sql` in the Supabase SQL editor, or:
```bash
psql "$SUPABASE_DB_URL" -f migrations/001_eds_polling.sql
```

### Run locally
```bash
uvicorn app.main:app --reload --port 8000
```
- Health: `GET /health`  &nbsp;&nbsp;|  Readiness: `GET /ready`
- OpenAPI docs: `http://localhost:8000/docs`

### Run the frontend shell locally
```bash
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

- Next.js frontend lives at `src/app`
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
Cloud Scheduler --OIDC/secret--> FastAPI /internal/jobs/poll-*
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
| Poll from FastAPI on GCP (not `pg_cron`) | Polling logic is list-then-detail + rolling-window + line-item flattening + GeoJSON parsing. SQL is the wrong language for that; Python has retries, Pydantic, mocks, tests. |
| Raw `jsonb` layer + normalized tables | Decouples ingestion from schema evolution. If EDS adds a field, we already have it — normalize later, no re-poll. |
| Cloud Scheduler + shared-secret OR OIDC | Two accepted credentials. Dev uses header token, prod uses Google-signed OIDC. |
| `supabase-py` with service-role key | Backend-only writes bypass RLS. User-scoped reads (future) should use per-request anon client + user JWT. |

---

## API

### Public

| Method | Path | Description |
|---|---|---|
| GET | `/` | Service info |
| GET | `/health` | Liveness (no I/O) |
| GET | `/ready` | Readiness (checks Supabase) |
| POST | `/calculations/fuel-efficiency` | mpg (+ duration) for a trip |

### Internal (auth-gated, called by Cloud Scheduler)

All require `Authorization: Bearer <token>` — either `INTERNAL_JOB_TOKEN` (shared
secret) or a Google-signed OIDC ID token with audience `INTERNAL_JOB_OIDC_AUDIENCE`.

| Method | Path | Description |
|---|---|---|
| POST | `/internal/jobs/ping` | Validates EDS connectivity + partner info |
| POST | `/internal/jobs/poll-accounts` | Full dump of `/getAccounts` -> accounts |
| POST | `/internal/jobs/poll-drivers` | Full dump of `/getDrivers` -> drivers |
| POST | `/internal/jobs/poll-transactions?window_days=3` | Rolling window -> transactions + line items |
| POST | `/internal/jobs/poll-documents` | Full dump of `/getDocuments` -> documents |

For `poll-transactions`, `start_date` and `end_date` (ISO) can be passed for
backfills; they override `window_days`.

---

## Polling cadence (recommended)

| Endpoint | Schedule | Strategy |
|---|---|---|
| `/internal/jobs/ping` | every 3 hours | Liveness — alert on 5xx / 401 |
| `/internal/jobs/poll-transactions` | every 3 hours | Rolling 3-day window; upserts by `transactionID`. Catches back-dated postings. |
| `/internal/jobs/poll-accounts` | every 3 hours | Full dump; upsert by `accountToken` |
| `/internal/jobs/poll-drivers` | every 3 hours | Full dump; upsert by `driverToken` |
| `/internal/jobs/poll-documents` | every 3 hours | Full dump; upsert by `docToken` |

Detail endpoints (`/getAccount/{token}`, `/getDriver/{token}`,
`/getDocument/{token}`) are **not** polled on a schedule. Call them
on-demand — the `EDSClient` methods exist (`get_account`, `get_driver`,
`get_document`) but aren't wired to scheduler jobs.

---

## Cloud Scheduler setup (GCP)

Two options for auth:

### Option 1 — Shared secret (simplest)
1. Set `INTERNAL_JOB_TOKEN` as a secret in **Google Secret Manager**, mount
   it as an env var on Cloud Run.
2. In Cloud Scheduler, create an HTTP job:
   - **Target:** HTTP, `POST`
   - **URL:** `https://<your-cloud-run-url>/internal/jobs/poll-transactions`
   - **Auth header:** `Add header` → `Authorization: Bearer <INTERNAL_JOB_TOKEN>`
     *(Scheduler supports an "Auth header" field — use that, don't paste the secret in "body".)*

### Option 2 — Google OIDC (recommended for prod)
1. Create a service account, e.g. `cloud-scheduler@PROJECT.iam.gserviceaccount.com`.
2. Grant it `roles/run.invoker` on your Cloud Run service (Cloud Run will
   verify the OIDC token at the edge *and* your app will verify it again).
3. Set on the backend:
   - `INTERNAL_JOB_OIDC_AUDIENCE` = the Cloud Run service URL (or an explicit audience string).
   - `INTERNAL_JOB_OIDC_SERVICE_ACCOUNT_EMAIL` = the scheduler SA email (optional — pins the caller).
4. In Cloud Scheduler, create the job with **Auth → Add OIDC token**, pick the
   SA, and set the same audience.

### Example `gcloud` job (shared-secret flavor)
```bash
gcloud scheduler jobs create http eds-poll-transactions \
  --location us-central1 \
  --schedule "*/10 * * * *" \
  --http-method POST \
  --uri "https://diesel-backend-xxxx-uc.a.run.app/internal/jobs/poll-transactions" \
  --headers "Authorization=Bearer ${INTERNAL_JOB_TOKEN}" \
  --attempt-deadline 540s
```

### Why not `pg_cron`?
We considered running jobs inside Supabase via `pg_cron` + `pg_net`. The
polling logic here has rolling windows, dedupe by id, line-item flattening,
and GeoJSON parsing — all painful in PL/pgSQL. We're already running a
backend on Cloud Run, so the marginal cost of a Cloud Scheduler trigger is
zero. `pg_cron` is still the right tool for **Supabase-internal maintenance**
(e.g., materialized-view refreshes, retention cleanup) — just not for
calling external APIs.

---

## CI/CD (GitHub Actions)

Every push to `main`, `dev`, or `staging` — and every PR targeting those
branches — runs the **Lint & Test** job. On merges to `main`, the **Build &
Deploy** job additionally builds a Docker image, pushes it to Artifact
Registry, and deploys it to Cloud Run.

### Workflow overview

```
PR / push
  └─ ci: ruff check + pytest
       └─ (main only) deploy:
            build docker image → push to Artifact Registry → gcloud run deploy
```

### One-time GCP setup

```bash
export PROJECT_ID=your-gcp-project-id
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
export REGION=us-central1
export SA=github-actions-deployer@$PROJECT_ID.iam.gserviceaccount.com

# 1. Enable APIs
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  secretmanager.googleapis.com

# 2. Create Artifact Registry repo
gcloud artifacts repositories create diesel-dashboard \
  --repository-format=docker \
  --location=$REGION

# 3. Create service account for GitHub Actions
gcloud iam service-accounts create github-actions-deployer \
  --display-name="GitHub Actions Deployer"

# 4. Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"

# Also allow the Cloud Run SA to act as itself (required for gcloud run deploy)
gcloud iam service-accounts add-iam-policy-binding \
  $PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member="serviceAccount:$SA" \
  --role="roles/iam.serviceAccountUser"

# 5. Set up Workload Identity Federation (keyless — no JSON key in GitHub)
gcloud iam workload-identity-pools create "github-pool" --location="global"

gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"

gcloud iam service-accounts add-iam-policy-binding $SA \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/your-org/diesel-dashboard-backend"
```

The full WIF provider name (needed as a GitHub secret below) is:
```
projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

### GitHub secrets to configure

In **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | your GCP project ID |
| `GCP_REGION` | e.g. `us-central1` |
| `GCP_SERVICE_NAME` | e.g. `diesel-dashboard-backend` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | full WIF provider resource name (above) |
| `GCP_SERVICE_ACCOUNT` | `github-actions-deployer@$PROJECT_ID.iam.gserviceaccount.com` |

App secrets (`SUPABASE_*`, `EDS_API_BEARER_TOKEN`) **never go into GitHub** —
they live in GCP Secret Manager and are mounted as env vars at Cloud Run
deploy time via `--set-secrets`.

### CORS

Update `CORS_ORIGINS` in the `deploy` job inside
`.github/workflows/deploy.yml` to include your production frontend domain:

```yaml
--set-env-vars APP_ENV=prod,LOG_LEVEL=INFO,APP_TIMEZONE=America/Los_Angeles,CORS_ORIGINS=https://your-frontend.com
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
