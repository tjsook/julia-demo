# Customizing Julia for a New Customer

Julia is a voice-driven ROI conversation demo. Everything customer-specific
lives in a small number of files. This doc lists the fill-in-the-blank
values in one place, in the order you should touch them.

If you only care about "make it sound and look like Acme Freight instead of
the default," you can finish this in ~10 minutes with the **Quick start**
below. The **Full reference** covers ROI-engine tuning for a genuinely
different customer profile.

---

## Quick start (branding + demo copy)

### 1. Frontend brand — `frontend/lib/brand.ts`

Fill in the three fields, or set the matching `NEXT_PUBLIC_*` env vars in
`frontend/.env.local` (env vars take precedence when present):

| Field | Env var | Example | Where it shows |
|---|---|---|---|
| `name` | `NEXT_PUBLIC_BRAND_NAME` | `Acme Freight` | Report header, tab title |
| `logoUrl` | `NEXT_PUBLIC_BRAND_LOGO_URL` | `/acme-logo.png` | ROI report header |
| `productName` | `NEXT_PUBLIC_PRODUCT_NAME` | `Acme ROI Assistant` | Browser tab |

Drop the logo file itself into `frontend/public/` (or point `logoUrl` at
any absolute URL).

### 2. Backend brand normalization — `backend/app/data/julia/calibration.json`

Fill in the company name Julia should normalize toward. Add every mis-spelling
you've seen Whisper produce for that name (helps STT accuracy when the rep
speaks the brand out loud):

```json
"brand_normalization": {
  "target": "Acme Freight",
  "variants": ["acme", "acme frate", "acmy freight", "ackme"]
}
```

Leave `variants: []` if you don't have transcription samples yet.

### 3. Demo user identity — `backend/app/main.py`

The demo bypasses real auth with a stub user. Change the email if you want
the demo to appear as a specific user:

```python
def _demo_dashboard_user() -> DashboardUser:
    return DashboardUser(subject="julia-demo", email="demo@example.com")
```

### 4. Whisper priming (optional) — `backend/app/services/julia_openai_service.py`

The `_WHISPER_PROMPT` constant primes the STT model on what to expect. It's
already generic for trucking. If you're demoing a non-trucking vertical
(e.g. plumbing, HVAC), edit it:

```python
_WHISPER_PROMPT = (
    "The speaker is a salesperson describing an HVAC-contractor prospect. "
    "Expect metrics like number of technicians, service calls per day, "
    "and average ticket size."
)
```

You're done with branding. Restart both servers and the demo shows the new
identity end-to-end.

---

## Full reference — ROI engine tuning

Everything below only matters if the *numbers* Julia calculates need to
change (different labor rates, different pain points, different equations).

### `backend/app/data/julia/calibration.json`

Top-level sections:

| Section | What it does |
|---|---|
| `schema_version` | Bump when you make non-additive changes so old cached calibrations invalidate. |
| `honesty_markers_enabled` | Toggle the "implied ratio" honesty markers Julia adds to soft numbers. |
| `constants` | The 11 ROI constants — labor cost per hour, minutes per manual load, detention rate, etc. **Biggest customer-specific dials.** |
| `derivation_rules` | How the 5 core inputs (`T`, `S`, `P`, `Ld`, `Du`) are derived from raw fleet data. Only touch if you change what "spot share" means for a given customer's ops. |
| `pain_points` | The 8 pain-point definitions + trigger phrases + which equation each maps to. Add new industry vocabulary here — see below. |
| `intent_classifier` | Token-count and metric-count thresholds that route utterances to ROI-analysis vs unknown-intent. |
| `brand_normalization` | Covered above. |
| `extraction` | LLM extraction tuning — mostly `numeric_confidence_threshold` for accepting a number. |
| `qualitative_buckets` | The 5-bucket enums for `S` (spot share) and `Du` (detention unbilled). Edit the numeric anchors if your customer's language means something different by "mostly spot". |
| `evidence_verification` | Fuzzy-match ratio for pain-point evidence (default 75%). Lower = looser pain-point matching. |
| `sanity_bands` | Min/max plausible ranges per input. Rejects hallucinations like `S = 150`. Widen or narrow per customer. |

#### Adding a pain point

1. Add an entry under `pain_points`:
   ```json
   "customer_specific_pain": {
     "equation": "E_new",
     "triggers": ["they're bleeding on X", "X is a mess"],
     "description": "Short human label for the report"
   }
   ```
2. Add the matching equation implementation in
   `backend/app/services/julia_roi_engine.py`.
3. Bump `schema_version`.

#### Adjusting a constant

Every constant has a comment in the JSON (or should — add one if not) describing
what it represents. Change the value only; the key stays stable so the engine
finds it.

### Voice prompts — `backend/app/routers/julia_routes.py`

The questions Julia asks live at the top of this file as string constants:

- `ROI_COMPANY_QUESTION_TEXT` — "Which company is this for?"
- `ROI_PAIN_POINTS_QUESTION_TEXT` — "What pain points did you identify..."
- `INITIAL_GREETING_TEMPLATE` — the "Hey {name}, what can I do for you today?" line
- `ROI_FIELD_QUESTIONS` — per-input questions (`T`, `S`, `P`, `Ld`, `Du`, `R`, etc.)
- `CANCEL_TTS_TEXT` — spoken cancel confirmation
- `EXPLICIT_CANCEL_PHRASES` / `CONTEXTUAL_NO_CANCEL_PHRASES` — phrases that let a user bail

Edit any string; Julia will speak the new wording on the next request.
No restart of the frontend needed.

### LLM extraction prompt — `backend/app/services/julia_openai_service.py`

The `extract_roi_brief` method builds the system prompt for LLM extraction.
For a genuinely different industry, this is where you'd rewrite what fields
Julia is extracting. Most of the *values* are already customer-tunable via
calibration.json — only touch the prompt if the *shape* of the extraction
changes.

### Backend env vars

`backend/app/core/config.py` documents every runtime setting. The Julia-relevant
ones:

| Env var | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | *(none)* | Required. STT / LLM / TTS all go through OpenAI. |
| `OPENAI_STT_MODEL` | `gpt-4o-mini-transcribe` | Whisper model. |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | TTS model. |
| `OPENAI_TTS_VOICE` | `marin` | Voice ID. Try `alloy`, `nova`, `shimmer`, etc. |
| `OPENAI_EXTRACTION_MODEL` | `gpt-4o-mini` | Field-extraction LLM. |
| `OPENAI_INTENT_MODEL` | `gpt-4o-mini` | Intent-classifier LLM (fallback path). |
| `JULIA_VOICE_AUDIO_MAX_MB` | `25` | Max upload size in MB. |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated. |
| `DASHBOARD_ALLOWED_EMAIL_DOMAIN` | `""` (disabled) | Only enforced when you remove the demo auth override in `main.py`. |

---

## Checklist for a new customer

Copy this into a PR description when spinning up a new customer's demo:

- [ ] `frontend/lib/brand.ts` — name, logo URL, product name
- [ ] `frontend/public/<customer>-logo.png` — logo file
- [ ] `backend/app/data/julia/calibration.json` — `brand_normalization.target` + `variants`
- [ ] `backend/app/main.py` — `_demo_dashboard_user()` email
- [ ] `backend/app/data/julia/calibration.json` — `constants` (labor rates, load times, etc.)
- [ ] `backend/app/data/julia/calibration.json` — `pain_points` triggers reflect the industry vocabulary
- [ ] `backend/app/services/julia_openai_service.py` — `_WHISPER_PROMPT` if not trucking
- [ ] Bump `calibration.json` `schema_version` if you changed non-additive fields
- [ ] Restart backend, `npm run dev` frontend, walk the demo end-to-end
