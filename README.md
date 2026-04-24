# diesel-dashboard

Hemut Diesel dashboard monorepo.

This repository contains:

- `frontend/`: Next.js dashboard UI
- `backend/`: Python + FastAPI service for EDS polling, Supabase ingestion, derived metrics, and internal job endpoints

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

Apply the EDS schema with:

```bash
psql "$SUPABASE_DB_URL" -f backend/migrations/001_eds_polling.sql
```

## Current State

Phase 1 EDS ingestion is partially implemented in `backend/`. HubSpot sync ingestion and EDS-to-HubSpot mapping are not implemented yet.
