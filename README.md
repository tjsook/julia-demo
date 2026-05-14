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

Apply all migrations in order (`001` through latest in `backend/migrations/`).
Recent schema additions include:

- HubSpot deal stage catalog + transitions (`009`, `010`, `011`)
- Manual mapping persistence guardrails (`012`, `013`)
- HubSpot calls ingestion tables (`014`)

## Current State

EDS ingestion is implemented for the current polling scope. HubSpot sync ingestion is implemented as a periodic read model into Supabase for users, deals, companies, contacts, tasks, calls, and deal pipeline stage metadata.

HubSpot sync entrypoints:

- `/internal/jobs/poll-hubspot-users`
- `/internal/jobs/poll-hubspot-deals`
- `/internal/jobs/poll-hubspot-companies`
- `/internal/jobs/poll-hubspot-contacts`
- `/internal/jobs/poll-hubspot-tasks`
- `/internal/jobs/poll-hubspot-calls`
- `/internal/jobs/poll-hubspot-deal-pipelines`
- `/internal/jobs/poll-hubspot-all`

The dashboard should read HubSpot-derived state from the database, not live HubSpot API calls on page load. EDS-to-HubSpot mapping remains a separate Phase 1.4 track.
