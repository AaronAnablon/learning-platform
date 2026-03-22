This is a full-stack learning platform starter using Next.js for frontend + server runtime, with scaffolding for Supabase, Stripe, OpenAI, LangChain (Python), and video generation workflows.

## Stack

- Frontend: Next.js 14, React 18, TypeScript, Tailwind CSS
- Backend: Supabase (PostgreSQL), Next.js API routes, Supabase serverless function scaffolding
- AI: OpenAI GPT model integration in Next.js + LangChain Python service scaffold
- Video: FFmpeg/Manim integration placeholders
<!-- - Video: FFmpeg/Manim/HeyGen integration placeholders -->
- Payments: Stripe checkout session endpoint

## Getting Started

1) Install dependencies:

```bash
npm install
```

2) Add environment values:

```bash
cp .env.example .env.local
```

3) Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deployment: Vercel + Render

This repo supports a split deployment model:

- Frontend + control-plane APIs on **Vercel**
- Heavy render worker (`ai-service`) on **Render**
- Data/storage/orchestration on **Supabase**

### 1) Deploy frontend to Vercel

1. Import this repository in Vercel.
2. Keep project root as `learning-platform`.
3. Set environment variables in Vercel project settings:
	 - `NEXT_PUBLIC_SUPABASE_URL`
	 - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
	 - `SUPABASE_URL`
	 - `SUPABASE_SERVICE_ROLE_KEY`
	 - `SUPABASE_VIDEO_FUNCTION=process-video`
	 - `SUPABASE_STORAGE_BUCKET=render-artifacts`
	 - `OPENAI_API_KEY`, `OPENAI_MODEL`
	 - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### 2) Deploy AI worker to Render

Two options:

- **Blueprint:** create a new Blueprint in Render using `render.yaml`.
- **Manual Web Service:** point Render to `ai-service/` and use Docker runtime.

`ai-service/Dockerfile` installs FFmpeg and starts FastAPI with Uvicorn.

Required Render env values:

- `FFMPEG_PATH=ffmpeg`

After deploy, copy the public service URL, e.g.:

- `https://learning-platform-ai-service.onrender.com`

### 3) Wire Supabase Function to Render URL

Set Supabase function secrets (project-level):

```bash
npx supabase secrets set \
	PYTHON_AI_SERVICE_URL=https://your-render-service.onrender.com \
	SUPABASE_STORAGE_BUCKET=render-artifacts
```

Then deploy (or redeploy) edge function:

```bash
npx supabase functions deploy process-video
```

### 4) Validate end-to-end

1. Call `POST /api/video/render` from your deployed frontend.
2. Query `GET /api/video/jobs?lessonId=<id>`.
3. Confirm `status=completed` and signed artifact URLs in job response.

## Included Endpoints

- `GET /api/health`
<!-- - `GET /api/heygen/test` -->
- `POST /api/generate-text`
- `POST /api/create-checkout-session`
- `POST /api/stripe/webhook`
- `POST /api/video/render`
- `GET /api/video/jobs`
- `GET /api/video/jobs/:jobId`

### Replay Render API (MVP Scaffold)

`POST /api/video/render` now expects a replay payload:

- `lessonId: string`
- `events: ReplayEvent[]` (pen strokes, erases, slide changes, voice markers)
- Optional: `audioUrl`, `options`

The route compiles events into a Manim scene script and dispatches to the Supabase Edge Function (`process-video` by default).

Required environment variables for dispatch mode:

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`
- Optional: `SUPABASE_VIDEO_FUNCTION` (defaults to `process-video`)
- Optional: `SUPABASE_STORAGE_BUCKET` (defaults to `render-artifacts`)
- Optional: `PYTHON_AI_SERVICE_URL` (public URL of Render AI service)
- Optional: `PYTHON_AI_SERVICE_URL` (used by `process-video` to request FFmpeg-rendered artifacts)

If env vars are missing, the API returns `dry-run` with the compiled payload.

The `process-video` function uploads render artifacts to Supabase Storage and returns signed URLs (30-day expiry) for:

- Scene script (`scene.py`)
- HLS manifest (`index.m3u8`)
- MP4 output (`lesson.mp4`)
- Render metadata (`metadata.json`)

Artifact generation mode:

- `python` mode: pulls real FFmpeg-rendered MP4/HLS/script artifacts from `PYTHON_AI_SERVICE_URL`.
- `placeholder` mode: safe fallback when Python render service is unreachable.

### Render Job Persistence

Apply the migration in `supabase/migrations/20260322_create_render_jobs.sql` to create `render_jobs` tracking.

Tracked statuses:

- `dry_run`
- `queued`
- `running`
- `completed`
- `failed`

## Stripe Setup (Test Mode)

1) Add test keys from Stripe Dashboard Developers > API keys:

- `STRIPE_SECRET_KEY=sk_test_...`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- `STRIPE_PRICE_ID=price_...`

2) Start your app:

```bash
npm run dev
```

3) Install and authenticate Stripe CLI:

```bash
stripe login
```

4) Forward events to your local webhook route:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

5) Copy the webhook signing secret printed by Stripe CLI (`whsec_...`) into:

- `STRIPE_WEBHOOK_SECRET=whsec_...`

6) Trigger a test event:

```bash
stripe trigger checkout.session.completed
```

<!--
## HeyGen API Key Setup

1) Create/sign in to your HeyGen account.
2) Open API settings in the HeyGen dashboard.
3) Generate or copy your API key.
4) Add it to:

- `HEYGEN_API_KEY=...`

5) Verify your key locally:

```bash
curl http://localhost:3000/api/heygen/test
```

If valid, the response includes `"ok": true`.
-->

## AI Service (Python)

The `ai-service/` folder includes a starter FastAPI service for LangChain-based workflows.

```bash
cd ai-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Replay-specific AI service endpoints:

- `POST /compile-replay` (events -> compiled script + chapters)
- `POST /render-replay` (render job payload -> queued job metadata)

## Supabase Functions

A starter function exists at `supabase/functions/process-video/index.ts` for serverless job orchestration.
