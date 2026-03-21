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

## Included Endpoints

- `GET /api/health`
<!-- - `GET /api/heygen/test` -->
- `POST /api/generate-text`
- `POST /api/create-checkout-session`
- `POST /api/stripe/webhook`
- `POST /api/video/render`

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

## Supabase Functions

A starter function exists at `supabase/functions/process-video/index.ts` for serverless job orchestration.
