# AI Portfolio — 10 AI Applications

**[View the live portfolio →](https://jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/)**

Ten independently deployed AI applications, each a standalone Vite project with its own
Netlify site and serverless API layer. The frontends are live; provider-backed task flows
require the configured production provider account to have available credit.

**Tech stack:** React 19 · Vite 6 · TypeScript 5.7 · shared CSS design tokens · Netlify Functions v2 · OpenRouter (one fixed model per app; app-06 compares models)

Chat and vision calls go from the server to OpenRouter. Each app pins one model,
`~anthropic/claude-haiku-latest`, except app-06 ModelArena, which compares models from the live
OpenRouter catalogue. Speech-to-text (app-04, Deepgram) and browser sessions (app-10, Browserbase)
use their own server-side keys. The browser never receives any key, and the served model is shown
wherever the provider reports it.

---

## Apps

### 1. AgentFlow — Multi-Agent Research Orchestrator
**[Live Demo](https://jdgafx-app-01-multi-agent-orchestrator.netlify.app)** · `app-01-multi-agent-orchestrator/`

Interactive React Flow graph orchestrating 4 AI agents (Researcher, Analyst, Critic, Synthesizer).
Each agent's output appears when it finishes, delivered over server-sent events. Visual pipeline
showing agent status, token counts, and elapsed time. Runs on one fixed OpenRouter model
(`~anthropic/claude-haiku-latest`) on the server.

### 2. DocMind — RAG Document Intelligence
**[Live Demo](https://jdgafx-app-02-rag-document-intelligence.netlify.app)** · `app-02-rag-document-intelligence/`

Upload PDFs and query them in natural language. Client-side PDF parsing with in-context RAG,
source highlighting, and relevance scoring.

### 3. CodeLens AI — AI Code Review Agent
**[Live Demo](https://jdgafx-app-03-ai-code-review.netlify.app)** · `app-03-ai-code-review/`

Paste code and receive inline AI reviews with severity ratings (critical/warning/info),
line-by-line annotations, and improvement recommendations.

### 4. VoxAI — Voice AI Assistant
**[Live Demo](https://jdgafx-app-04-voice-ai-assistant.netlify.app)** · `app-04-voice-ai-assistant/`

Voice-powered assistant with real-time waveform visualization. Mic capture via the Web Audio API,
Deepgram `nova-3` speech-to-text, chat answers from one fixed OpenRouter model, and browser
`speechSynthesis` for TTS playback.
A text input covers the no-microphone case.

### 5. DataPilot — AI Data Analyst
**[Live Demo](https://jdgafx-app-05-ai-data-analyst.netlify.app)** · `app-05-ai-data-analyst/`

Upload CSV data or use a sample dataset, then ask questions in natural language. The model
generates a query plan that is executed client-side and rendered as interactive Recharts visualizations.

### 6. ModelArena — Multi-Model LLM Playground
**[Live Demo](https://jdgafx-app-06-llm-playground.netlify.app)** · `app-06-llm-playground/`

Side-by-side comparison of one prompt. Panel A always runs the fixed Claude Haiku alias. Panels B and C
take any model from the live OpenRouter catalogue, grouped by speed, reasoning, agentic work, value and
frontier quality. Each run shows measured latency, tokens and cost, an evidence summary, and an AI judge note.

### 7. ContentForge — Agentic Content Pipeline
**[Live Demo](https://jdgafx-app-07-content-pipeline.netlify.app)** · `app-07-content-pipeline/`

Five-step content generation pipeline: Research → Outline → Draft → Edit → Polish. Each stage is
one short model call with its own trace row, expandable output and copy button. Resume and Retry
reuse finished stages.

### 8. VisionLab — Multimodal Vision AI
**[Live Demo](https://jdgafx-app-08-vision-ai.netlify.app)** · `app-08-vision-ai/`

Upload images for multimodal analysis on one fixed vision-capable model (`~anthropic/claude-haiku-latest`). Supports scene description, object and
composition breakdown, text extraction, and visual Q&A.

### 9. InsightHub — SaaS Analytics Dashboard
**[Live Demo](https://jdgafx-app-09-ai-saas.netlify.app)** · `app-09-ai-saas/`

SaaS analytics dashboard with Supabase authentication and seeded usage data — API calls,
feature usage, error rates, and latency across a 30-day window rendered in interactive Recharts.
The dashboard dataset is explicitly seeded for the visitor experience; AI insights stream from the
configured model provider when that backend is available.

### 10. BrowseBot — Browser Task Planner
**[Live Demo](https://jdgafx-app-10-browser-agent.netlify.app)** · `app-10-browser-agent/`

AI-generated browser-task plans executed in a bounded Browserbase session against an explicit public-domain
allowlist. The UI streams observed URLs, page titles, page text, step events, planner model provenance,
session evidence, and recoverable time, step, budget, and cancellation boundaries.

---

## n8n Automations — Enterprise Workflow Portfolio

**[n8n-automations/](n8n-automations/)** — five production-grade n8n workflows proven with
real executions: lead capture with LLM scoring, AI support triage with real vector RAG,
AP invoice extraction with a human approval gate, resilient cross-system data sync
(backoff + dead-letter queue + replay), and a KPI watchdog with anomaly detection and
LLM executive digests. Every workflow ships with a central error handler, idempotency,
boundary validation, an adapter pattern for third-party systems, execution-ID evidence,
and canvas screenshots. See [n8n-automations/README.md](n8n-automations/README.md).

---

## Repository layout

```
JDGAFX_CG_GITHUB_PORTFOLIO_APPS/
├── app-01-multi-agent-orchestrator/
├── app-02-rag-document-intelligence/
├── app-03-ai-code-review/
├── app-04-voice-ai-assistant/
├── app-05-ai-data-analyst/
├── app-06-llm-playground/
├── app-07-content-pipeline/
├── app-08-vision-ai/
├── app-09-ai-saas/
├── app-10-browser-agent/
├── n8n-automations/         — enterprise n8n workflow portfolio (JSON + docs + evidence)
├── docs/index.html          — landing page served via GitHub Pages
├── .github/workflows/ci.yml — typecheck, lint, test and build for every app on push and PR
├── test-all-apps.sh         — live smoke suite: one real task per deployed app
├── LICENSE
└── README.md
```

Each app follows the same structure:

- `src/` — React 19 + TypeScript frontend
- `netlify/functions/` — Netlify Functions v2 handlers, each declaring its own route
  via `export const config = { path: '/api/...' }`
- `netlify.toml` — build, functions, security headers, and SPA fallback

## Setup

Every app is self-contained. Install and run whichever one you want:

```bash
cd app-01-multi-agent-orchestrator   # or any other app
npm install
npm run dev                          # Vite dev server on :5173 (frontend only)
```

The frontend calls a serverless function, so use the Netlify CLI to run the full app locally:

```bash
npx netlify dev                      # frontend + functions on :8888
```

### Environment variables

Set these in a `.env` file at the app root for local development, or in the Netlify dashboard
per site for production.

| Variable | Required by | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | all 10 apps | Server-side key for OpenRouter model calls. Never exposed to the browser. |
| `DEEPGRAM_API_KEY` | app-04 | Server-side Deepgram `nova-3` speech-to-text key. Never exposed to the browser. |
| `BROWSERBASE_API_KEY` | app-10 | Server-side Browserbase key for bounded browser sessions. Never exposed to the browser. |
| `BROWSERBASE_PROJECT_ID` | app-10 | Browserbase project that owns those sessions. |
| `VITE_SUPABASE_URL` | app-09 | Supabase project URL for dashboard authentication. |
| `VITE_SUPABASE_ANON_KEY` | app-09 | Supabase anonymous key, safe for client-side use. |

## Quality checks

Every app has its own README (what it does, the agentic steps it shows, how to run and test it,
its live URL and known limits) and the same four checks:

```bash
cd app-03-ai-code-review        # or any other app
npm run typecheck               # TypeScript strict, project build
npm run lint                    # ESLint flat config, zero warnings allowed
npm test                        # Vitest: unit tests for the core logic plus a smoke test of each
                                # Netlify Function with the provider mocked (no key, no network)
npm run build
```

The GitHub Actions workflow in `.github/workflows/ci.yml` runs all four for each of the ten apps on
every push to `main` and on every pull request.

`test-all-apps.sh` is the live smoke suite. It drives every deployed app's frontend and function
endpoints with one real task each and asserts real values in the responses.

```bash
./test-all-apps.sh              # all apps against production
./test-all-apps.sh local        # all apps against localhost:8888
./test-all-apps.sh app-03       # a single app against production
```

## Deployment

Each app is its own Netlify site and auto-deploys on push to `main`. The landing page in `docs/`
is served by GitHub Pages at
[jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS](https://jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/).

---

Built by Christopher Gentile ([@jdgafx](https://github.com/jdgafx)) · [MIT License](LICENSE)
