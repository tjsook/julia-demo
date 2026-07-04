# Julia Demo

Standalone extraction of the Julia AI assistant from `Hemut's Diesel Dashboard`.
Voice-driven ROI conversation + demo shell, without the surrounding dashboard.

Julia is a ROI presentation assistant. She's powered by an OpenAI engine built on FastAPI and utilizes Pydantic-backed data normalization to converse with reps mid-pitch to create a structured output on how potential customers can benefit from services. She's designed to create a "wow" factor as well, so her "orb" is literally ~9000 points on a sphere using a golden-angle distribution, animated with distortion-seeded 3D noise.

I built it to assist our sales operations in Hemut, so it's supposed to be niche and relative to our company. I had to perform a migration to rip it out of its GTM dashboard parent-entity (which I also built), for presentation purposes.

The repo has been stripped down to a generic, blank yet customizable ROI-bot (given keys).

Extracted with `git filter-repo` on 2026-07-03. Every Julia source file
here is byte-for-byte the file from `diesel-dashboard`, with its full
commit history preserved. Only two files were replaced with lean boot
shims (both were app-shell glue, not Julia logic):

- `backend/app/main.py` — original wired 18 routers; shim mounts only
  `julia_router` and overrides `require_dashboard_user` with a demo stub
  so the API works without a real dashboard session.
- `frontend/pages/index.tsx` — original was the dashboard landing;
  shim redirects `/` to `/julia/demo`.

`frontend/pages/api/submit-ticket.ts` was deleted (non-Julia).

## Layout

```
frontend/          Next.js pages-router app
  pages/julia/       demo page
  components/Julia/  Demo + Hub components
  hooks/julia/       useJuliaDemo, useJuliaVoice, useJuliaUpload, useJuliaDocuments
  lib/julia/         api client, types, recorder, VAD wrapper, fillers, amplitude
  styles/            julia.module.css + globals.css
backend/
  app/routers/       julia_routes.py
  app/services/      julia_*.py (openai, roi engine, matcher, intent router, calibration, document)
  app/schemas/       julia_models.py + julia_roi_models.py
  app/repositories/  julia_document_repository.py (Supabase-backed)
  app/data/julia/    calibration.json
  app/core/          config, errors, julia_validation
  app/dependencies/  dashboard_auth
planning-docs-private/julia/    architecture docs (gitignored, retained on disk)
```

## Running

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
# Supabase envs are only needed if you exercise the document endpoints
# (upload / signed URL / doc list). Pure voice-ROI flow doesn't require them.
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# .env.local — point the frontend at your backend
# NEXT_PUBLIC_JULIA_API_BASE=http://localhost:8000
npm run dev
```

Open <http://localhost:3000> — it redirects to `/julia/demo`.

## Rebranding for a new customer

See [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for the fill-in-the-blank
checklist covering brand name, logo, calibration constants, and pain-point
vocabulary.

## What still needs wiring for a real demo

1. **NextAuth**: `frontend/pages/_app.tsx` still wraps in `SessionProvider`;
   `useCurrentUser` reads `session.user.name/email`. Either configure NextAuth
   with a provider, or replace `frontend/lib/auth.ts` with a hardcoded demo user.
2. **OpenAI API key**: required for STT / LLM / TTS. Set in backend env.
3. **Supabase**: only needed for Julia Hub (document upload + retrieval). The
   voice → ROI flow works without it. `backend/app/repositories/julia_document_repository.py`
   hits Supabase via `httpx`; leave the env vars unset and those endpoints will 500.
4. **Auth dependency override**: the shim in `main.py` bypasses Google-ID-token
   verification. Delete `app.dependency_overrides[require_dashboard_user]` when
   plugging into a real auth flow.

## History

Full git history for every Julia file is preserved. Look at
`planning-docs-private/julia/` (on disk, gitignored) for the architecture
docs behind each optimization pass (opt-1 through opt-4, plus the visual
polish plan and other initiatives).
