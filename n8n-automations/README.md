# n8n Automations — Enterprise Workflow Portfolio

Five production-grade n8n workflows, built and proven on n8n 2.32.7 with real executions
(execution IDs, data-table row counts, and canvas/execution screenshots in each doc).
These are the automation categories companies most often pay for, each built to an
enterprise reliability bar rather than demo-ware.

## Workflows

| # | Workflow | What it proves | Doc |
|---|----------|----------------|-----|
| 00 | [Core Error Handler](workflows/00-error-handler.json) | Central error-catcher: every workflow routes failures to one audit log | shared |
| 01 | [Lead Capture → Enrich → Score → CRM](workflows/01-lead-capture-crm.json) | Idempotent intake, LLM lead scoring (structured JSON), hot-lead routing, <10s webhook response | [docs/01](docs/01-lead-capture-crm.md) |
| 02 | [AI Support Triage with RAG](workflows/02-support-triage-rag.json) | Real vector RAG (OpenRouter embeddings), 8/8 retrieval-correctness probes, severity routing + SLA escalation, grounded drafting with refusal | [docs/02](docs/02-support-triage-rag.md) |
| 03 | [AP Invoice Pipeline](workflows/03-ap-invoice-pipeline.json) | LLM document extraction with validation rules, human approval gate over $5k, dedupe, exception queue | [docs/03](docs/03-ap-invoice-pipeline.md) |
| 04 | [Resilient Cross-System Data Sync](workflows/04-resilient-data-sync.json) | Exponential backoff + jitter (timings measured), dead-letter queue with replay, last-write-wins conflict resolution, full audit trail | [docs/04](docs/04-resilient-data-sync.md) |
| 05 | [KPI Watchdog](workflows/05-kpi-watchdog.json) | Scheduled pulls from live public APIs, rolling-mean anomaly detection, LLM executive digest, graceful source-down degradation | [docs/05](docs/05-kpi-watchdog.md) |

## Engineering standards applied to every workflow

- **Central error workflow** — every workflow sets `errorWorkflow` to the shared handler, which writes structured rows to an error log table. Proven with forced failures in every workflow.
- **Idempotency** — deterministic keys + check-before-create; duplicate submissions return the existing result without side effects.
- **Retries with backoff** — transient failures retry before landing in a dead-letter queue that supports replay.
- **Adapter pattern** — external systems (Slack, CRM, accounting, email) are isolated behind clearly-named sub-workflows that write to n8n Data Tables in this demo. Each doc has a swap table showing the one-node change to connect the real system. Every workflow is fully runnable with zero third-party accounts.
- **Validation at the boundary** — malformed payloads get specific 400s and never reach an LLM.
- **Canvas hygiene** — sticky-note documentation per section, sub-workflow modularity, no monolith canvases.
- **Honest failure semantics** — a node failure returns a real 5xx to the caller (not an empty 200) *and* still logs to the error handler.

## Running locally

```bash
cd local
cp .env.example .env   # fill in secrets (or generate: openssl rand -hex 24)
docker compose up -d   # n8n 2.x + Postgres + external task runner
```

Then import the JSON files from `workflows/` (n8n UI or `n8n import:workflow --input=<file>`),
create an OpenRouter credential, re-point the credential and error-handler placeholders, and
activate. Each workflow doc lists its webhook path and sample payloads.

## Evidence

Every doc contains a real execution-evidence table (execution IDs, durations, outcomes),
the retrieval/backoff/dedupe proofs specific to that workflow, and screenshots under
[docs/img/](docs/img/) captured from the live instance.
