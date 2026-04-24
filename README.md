# diesel-dashboard

Hemut Diesel dashboard monorepo.

This repository contains:

- `frontend/`: Next.js dashboard UI
- `backend/`: Python + FastAPI service for EDS polling, HubSpot sync ingestion, Supabase ingestion, derived metrics, and internal job endpoints

Supabase is the system of record. The frontend calls the backend over HTTP using `NEXT_PUBLIC_API_URL`.

## Docs

- [Stack Overview](./STACK.md)
- [Architecture](./ARCHITECTURE.md)
- [Phased Delivery Plan](./PHASES.md)
- [Data Contracts and Decisions](./DATA-CONTRACTS.md)
- [Job Schedule](./SCHEDULE.md)

## Local Setup

Fill in `.env.example` and copy it to `.env` or `.env.local`.

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Database

Apply the current schemas with:

```bash
psql "$SUPABASE_DB_URL" -f backend/migrations/001_eds_polling.sql
psql "$SUPABASE_DB_URL" -f backend/migrations/002_fueling_activity.sql
psql "$SUPABASE_DB_URL" -f backend/migrations/003_hubspot_sync.sql
```

## Current State

Phase 1 EDS ingestion is implemented for the current backend polling scope. Phase 1.3 HubSpot sync ingestion is implemented as a read-only periodic sync into Supabase for users, deals, companies, contacts, and tasks.

HubSpot sync entrypoints:

- `/internal/jobs/poll-hubspot-users`
- `/internal/jobs/poll-hubspot-deals`
- `/internal/jobs/poll-hubspot-companies`
- `/internal/jobs/poll-hubspot-contacts`
- `/internal/jobs/poll-hubspot-tasks`
- `/internal/jobs/poll-hubspot-all`

The dashboard should read HubSpot-derived state from the database, not live HubSpot API calls on page load. EDS-to-HubSpot mapping remains a separate Phase 1.4 track.
