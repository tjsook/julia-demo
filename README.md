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
- [ROI Demo Runbook](./docs/roi-demo.md)

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

## Git Hooks (Optional)

To auto-run Ruff fixes before every push:

```bash
./scripts/install-git-hooks.sh
```

The pre-push hook runs:

- `ruff check backend --fix`
- `ruff check backend`

If fixes are applied, push is blocked so you can review/stage/commit the changes first.

## Database

Apply all migrations in order (`001` through latest in `backend/migrations/`).
Recent schema additions include:

- HubSpot deal stage catalog + transitions (`009`, `010`, `011`)
- Manual mapping persistence guardrails (`012`, `013`)
- HubSpot calls ingestion tables (`014`)
- Affiliate program: `affiliates` table, `accounts.referral_code/attributed_at`, `hubspot_contacts.referral_code` (`015`, `016`, `017`)
- Affiliate payouts: `affiliate_payouts` table with reversal columns (`016`)

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

## Affiliate Program

See `planning-docs-private/AFFILIATE-PROGRAM-SPEC.md` for full spec.

### How it works

1. **DocuSign → affiliate row**: DocuSign Connect webhook (`POST /webhooks/docusign`) or 2×/day poll (`POST /internal/jobs/poll-docusign-affiliates`) syncs envelope status into `affiliates`. A 6-char referral code is generated on first insert.
2. **Attribution**: The EDS↔HubSpot mapping reconciliation job reads `hubspot_contacts.referral_code` and writes it onto `accounts`. `attributed_at` is set only when the affiliate's contract is `completed`.
3. **Qualification detection**: `POST /internal/jobs/detect-affiliate-qualifications` scans for attributed accounts with `total_gallons >= 1000` and no existing payout row, and inserts an `affiliate_payouts` row ($100 flat, `truck_count_snapshot=1`).
4. **Payout admin**: The Affiliates UI lets staff confirm W-9 receipt, queue payouts for the monthly batch, mark paid, and reverse if needed. CSV export at `GET /affiliates/payouts/export.csv`.

### Job endpoints (require `Authorization: Bearer <INTERNAL_JOB_TOKEN>`)

- `POST /internal/jobs/poll-docusign-affiliates` — sync envelopes from DocuSign (use `?lookback_days=N`)
- `POST /internal/jobs/detect-affiliate-qualifications` — create payout rows for newly qualified accounts

### Webhook

`POST /webhooks/docusign` — DocuSign Connect SIM endpoint. Verified via HMAC-SHA256 (`DOCUSIGN_CONNECT_HMAC_SECRET`). Configure in DocuSign Connect sandbox/prod admin pointing at the deployed backend URL.

### Deferred / out of scope (v1)

- SMS dispatch to affiliates (Twilio — phone stored, not used yet)
- Actual ACH/wire execution — CSV export hands off to finance/QuickBooks
- Auto-detection of account closure/chargeback/fraud for reversals (manual button only)
- Dynamic truck count for payout calculation (hardcoded to 1 = $100 flat; see `affiliate_qualification_service.py`)
- Affiliate-facing dashboard (`HemutDiesel_Affiliate` repo)
- Admin "merge affiliates" for re-sends with a different email address
