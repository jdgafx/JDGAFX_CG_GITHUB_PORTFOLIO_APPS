# AI Portfolio — 10 Production Apps

**[View the live portfolio →](https://jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/)**

Ten independently deployed AI applications, each a standalone Vite project with its own
Netlify site, serverless API layer, and CI/CD pipeline.

**Tech stack:** React 19 · Vite 6 · TypeScript 5.7 · Tailwind CSS v4 · Netlify Functions v2 · OpenRouter

All model traffic is routed through [OpenRouter](https://openrouter.ai), which serves both
Anthropic Claude and Google Gemini models behind a single API. Apps 02–09 use Claude
(Haiku, Sonnet, and Opus); apps 01 and 10 use Gemini Flash. Models are referenced through
OpenRouter's auto-updating `latest` aliases so the apps do not break when a specific model
version is retired.

---

## Apps

### 1. AgentFlow — Multi-Agent Research Orchestrator
**[Live Demo](https://jdgafx-app-01-multi-agent-orchestrator.netlify.app)** · `app-01-multi-agent-orchestrator/`

Interactive React Flow graph orchestrating 4 AI agents (Researcher, Analyst, Critic, Synthesizer)
with real-time SSE streaming. Visual pipeline showing agent status, token counts, and elapsed time.
Runs on Gemini Flash.

### 2. DocMind — RAG Document Intelligence
**[Live Demo](https://jdgafx-app-02-rag-document-intelligence.netlify.app)** · `app-02-rag-document-intelligence/`

Upload PDFs and query them in natural language. Client-side PDF parsing with in-context RAG,
source highlighting, and relevance scoring.

### 3. CodeLens AI — AI Code Review Agent
**[Live Demo](https://jdgafx-app-03-ai-code-review.netlify.app)** · `app-03-ai-code-review/`

Paste code and receive inline AI reviews with severity ratings (critical/warning/suggestion/praise),
line-by-line annotations, and improvement recommendations.

### 4. VoxAI — Voice AI Assistant
**[Live Demo](https://jdgafx-app-04-voice-ai-assistant.netlify.app)** · `app-04-voice-ai-assistant/`

Voice-powered assistant with real-time waveform visualization. Mic capture via the Web Audio API,
speech-to-text transcription, streaming chat, and browser `speechSynthesis` for TTS playback.
A text input covers the no-microphone case.

### 5. DataPilot — AI Data Analyst
**[Live Demo](https://jdgafx-app-05-ai-data-analyst.netlify.app)** · `app-05-ai-data-analyst/`

Upload CSV data or use a sample dataset, then ask questions in natural language. The model
generates a query plan that is executed client-side and rendered as interactive Recharts visualizations.

### 6. ModelArena — Multi-Model LLM Playground
**[Live Demo](https://jdgafx-app-06-llm-playground.netlify.app)** · `app-06-llm-playground/`

Side-by-side model comparison across Claude Haiku, Sonnet, and Opus. Enter a prompt, select models,
and watch responses stream simultaneously with latency, token count, and cost metrics.

### 7. ContentForge — Agentic Content Pipeline
**[Live Demo](https://jdgafx-app-07-content-pipeline.netlify.app)** · `app-07-content-pipeline/`

Five-step content generation pipeline: Research → Outline → Draft → Edit → Polish. Full SSE
streaming with per-step progress tracking and expandable output for each stage.

### 8. VisionLab — Multimodal Vision AI
**[Live Demo](https://jdgafx-app-08-vision-ai.netlify.app)** · `app-08-vision-ai/`

Upload images for multimodal analysis on Claude Sonnet. Supports scene description, object and
composition breakdown, text extraction, and visual Q&A.

### 9. InsightHub — SaaS Analytics Dashboard Demo
**[Live Demo](https://jdgafx-app-09-ai-saas.netlify.app)** · `app-09-ai-saas/`

SaaS analytics dashboard demo with Supabase authentication and simulated usage data — API calls,
feature usage, error rates, and latency across a 30-day window rendered in interactive Recharts.
The metrics are generated sample data; the AI insights are real and streamed live from the model.

### 10. BrowseBot — Browser Agent Demo
**[Live Demo](https://jdgafx-app-10-browser-agent.netlify.app)** · `app-10-browser-agent/`

Visual demonstration of AI browser automation. Animated browser chrome with cursor movement,
click ripples, and typing animation, driven by a real-time agent thought process panel on Gemini Flash.

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
├── docs/index.html          — landing page served via GitHub Pages
├── test-all-apps.sh         — end-to-end endpoint test suite
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
| `VITE_SUPABASE_URL` | app-09 | Supabase project URL for dashboard authentication. |
| `VITE_SUPABASE_ANON_KEY` | app-09 | Supabase anonymous key, safe for client-side use. |

## Testing

`test-all-apps.sh` exercises every function endpoint and frontend across all ten apps,
checking HTTP status, response format, error handling, streaming, and JSON parsing.

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

Built by Chris Gentile ([@jdgafx](https://github.com/jdgafx)) · [MIT License](LICENSE)
