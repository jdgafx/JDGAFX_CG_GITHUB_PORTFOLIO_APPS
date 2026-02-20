# AI Portfolio — 10 Production Apps

A collection of 10 fully-functional AI-powered applications showcasing hyper-agentic generative AI development. Each app is independently deployed on Netlify with its own CI/CD pipeline.

**Tech Stack:** React 19 · Vite 6 · TypeScript 5.7 · Tailwind CSS v4 · Netlify Functions v2 · Claude API

---

## Apps

### 1. AgentFlow — Multi-Agent Research Orchestrator
**[Live Demo](https://jdgafx-app-01-multi-agent-orchestrator.netlify.app)** · `app-01-multi-agent-orchestrator/`

Interactive React Flow graph orchestrating 4 AI agents (Researcher, Analyst, Critic, Synthesizer) with real-time SSE streaming. Visual pipeline showing agent status, token counts, and elapsed time.

### 2. DocMind — RAG Document Intelligence
**[Live Demo](https://jdgafx-app-02-rag-document-intelligence.netlify.app)** · `app-02-rag-document-intelligence/`

Upload PDFs and query them with natural language. Client-side PDF parsing with in-context RAG, source highlighting, and relevance scoring powered by Claude.

### 3. CodeLens AI — AI Code Review Agent
**[Live Demo](https://jdgafx-app-03-ai-code-review.netlify.app)** · `app-03-ai-code-review/`

Paste code and receive inline AI reviews with severity ratings (critical/warning/suggestion/praise), line-by-line annotations, and improvement recommendations.

### 4. VoxAI — Voice AI Assistant
**[Live Demo](https://jdgafx-app-04-voice-ai-assistant.netlify.app)** · `app-04-voice-ai-assistant/`

Voice-powered AI assistant with real-time waveform visualization. Mic capture via Web Audio API, Groq Whisper STT, Claude chat, and browser speechSynthesis for TTS playback.

### 5. DataPilot — AI Data Analyst
**[Live Demo](https://jdgafx-app-05-ai-data-analyst.netlify.app)** · `app-05-ai-data-analyst/`

Upload CSV data or use sample datasets. Ask natural language questions and get interactive Recharts visualizations. Claude generates query plans executed client-side.

### 6. ModelArena — Multi-Model LLM Playground
**[Live Demo](https://jdgafx-app-06-llm-playground.netlify.app)** · `app-06-llm-playground/`

Side-by-side Claude model comparison. Enter a prompt, select models, and watch responses stream simultaneously with latency, token count, and cost metrics.

### 7. ContentForge — Agentic Content Pipeline
**[Live Demo](https://jdgafx-app-07-content-pipeline.netlify.app)** · `app-07-content-pipeline/`

5-step AI content generation pipeline: Research → Outline → Draft → Edit → Polish. Full SSE streaming with step progress tracking and expandable output for each stage.

### 8. VisionLab — Multimodal Vision AI
**[Live Demo](https://jdgafx-app-08-vision-ai.netlify.app)** · `app-08-vision-ai/`

Upload images for Claude Vision analysis. Supports object detection descriptions, scene analysis, text extraction, and visual Q&A with multimodal AI.

### 9. InsightHub — AI-Powered SaaS Dashboard
**[Live Demo](https://jdgafx-app-09-ai-saas.netlify.app)** · `app-09-ai-saas/`

Analytics dashboard with Supabase authentication. Interactive Recharts metrics, usage tracking, and Claude-generated AI insights with streaming analysis.

### 10. BrowseBot — Browser Agent Demo
**[Live Demo](https://jdgafx-app-10-browser-agent.netlify.app)** · `app-10-browser-agent/`

Visual demonstration of AI browser automation. Animated browser chrome with cursor movements, click ripples, typing animations, and a real-time agent thought process panel.

---

## Architecture

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
└── README.md
```

Each app is a standalone Vite project with:
- `/src` — React 19 + TypeScript frontend
- `/netlify/functions` — Serverless API handlers (Claude, Groq, etc.)
- `/dist` — Production build output
- `netlify.toml` — Per-app deployment configuration

## Running Locally

```bash
cd app-01-multi-agent-orchestrator  # or any app
npm install
npm run dev                         # Vite dev server on :5173
```

For Netlify Functions locally:
```bash
npx netlify dev                     # Proxies functions on :8888
```

## Deployment

Each app auto-deploys to Netlify on push to `main`. Environment variables (API keys) are configured per-site in the Netlify dashboard.

---

Built by [@jdgafx](https://github.com/jdgafx)
