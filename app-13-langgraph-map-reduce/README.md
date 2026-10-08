# app-13-langgraph-map-reduce (GraphSwarm)

GraphSwarm is a document analyst built on LangGraph.js. Paste a document of 200 to 20,000 characters, or load the built-in sample (the United States Declaration of Independence). The graph splits the text into chunks, extracts key points from every chunk in parallel, merges them, writes a structured summary whose points cite chunk numbers, and checks coverage. If a chunk was missed, that chunk is re-run once. The run finishes with a coverage count, the summary, and a trace of every model call with its served model, tokens and cost.

The graph is the point of the app. A plain chain runs one call after another. This app needs a fan-out to a variable number of parallel branches (one per chunk), a reducer that merges branch results, and a conditional loop that sends only the missed chunks back for one more pass. LangGraph's `Send` and conditional edges express that directly, and the state reducers keep the parallel writes from colliding.

## The graph

```
START
  |
split ---- fan out: one Send per chunk (conditional edge) ----+
  |                                                           |
  |        extract x N, parallel, at most 4 model calls <-----+
  |                                                           |
  +<----------------------------------------------------------+
  |
reduce        merge findings, deduplicate entities (no model)
  |
synthesize    one cited summary (claude-haiku-latest)
  |
check         chunk-id coverage, plus one review call (mimo-v2.6-flash)
  |
  +-- missing chunks and retries < 1 --> Send extract for the missing chunks only
  |                                        |
  |                                        v
  |                             reduce -> synthesize -> check   (retries is now 1)
  |
  +-- otherwise -----------------------> final -> END
```

Conditional edges:

- After `split`: one `Send('extract', { chunk, total, pass: 1 })` per chunk.
- After `check`: when some chunks are missing and `retries` is below 1, one `Send('extract', { chunk, total, pass: 2 })` per missing chunk. Otherwise the run goes to `final`.

Cycles and limits:

- One cycle only. The retry runs at most once, after a 1.5 s pause, and only for chunks that are missing.
- At most 12 chunks. A long text gets larger chunks, not more of them.
- At most 4 extract calls run at once. The rest wait inside the request.
- Each model call times out after 20 s. The whole run has a 50 s budget.

Which node uses which model, and why. Prices are OpenRouter list prices per 1M tokens, checked 2026-10-08.

| Node | Model | Max output tokens | Price in / out per 1M | Why this model |
| --- | --- | --- | --- | --- |
| extract (one call per chunk) | openai/gpt-oss-20b | 400 | $0.018 / $0.09 | Many calls, so the lowest per-call price of the three |
| check (one call per run) | xiaomi/mimo-v2.6-flash | 300 | $0.14 / $0.28 | Short review of the summary, cheap |
| synthesize (one call per pass) | ~anthropic/claude-haiku-latest | 900 | $0.10 / $0.50 | The one stronger call, for the cited summary |

Every call sets `usage: { include: true }`, so OpenRouter reports its cost. When a call reports no cost, the app estimates it from the list prices above and labels the figure "estimated".

Extract and check send no JSON-mode, reasoning or provider option. Their replies are read tolerantly: the first complete JSON object in the reply is used, whether it sits in a code fence, after prose, or both. Synthesis asks for a JSON object, turns reasoning off and routes only to providers that accept every parameter it sends.

## What the UI shows

- A text area with a character counter, a "Run the sample" button that loads the Declaration and starts the run, and an Analyze button for your own text. Both buttons stay disabled while a run is in progress.
- The graph: split, one box per extract branch with its state, reduce, synthesize, check, and final. A retry shows as a labelled loop.
- The run trace: one row per finished node, with its milliseconds, the served model, tokens and cost. Each extract chunk has its own row.
- The summary. Each point shows a `[chunk n]` badge for every chunk it came from. A point without a valid citation shows no badge. The entities found across the document follow.
- The coverage card, for example "9 of 9 chunks covered", and any chunk still missing after the retry. If the retry pass does not finish, the first-pass summary is shown with a notice that says why.
- Totals: total time, total tokens, total cost, the cheap calls' cost, and the synthesis call's cost.

## Architecture

```
browser (React, Vite)
  -> POST /api/run  { text }                      Netlify Function (netlify/functions/run.ts)
       origin check, rate limit (20 per minute per client), body byte cap,
       field check (200 to 20,000 characters), OPENROUTER_API_KEY read on the server only
  <- text/event-stream frames, then [DONE]
       -> LangGraph StateGraph (netlify/shared/graph.ts) -> OpenRouter chat completions
```

- The key lives only in the function's environment. The browser never sees it, and error text never includes a provider body.
- A rejected key, or an out-of-credit account, halts every parallel call at once. A rate limit, a timed-out call, a server error or a refused request costs that chunk only, and the retry may recover it. If the first pass cannot produce a summary, the run ends with one error frame. If the retry pass fails for any reason, including a halt, the first-pass summary is returned with a notice. The coverage review is the exception: a provider error there is swallowed, the summary is kept, and the trace marks the review as failed.
- Every run ends with `data: [DONE]`, including after a failure.
- Each run builds its own graph, limiter and budget, so no state is shared between requests. The checkpointer is in memory and used per request only. This app does not resume runs.

Frames: `node_start`, `node_end`, `edge`, `result`, `error`, then `[DONE]`.

## Run locally

Environment variable names, not values: `OPENROUTER_API_KEY` (required), and `ALLOWED_ORIGINS` (optional, comma-separated extra origins).

```
npm ci
npm run dev                 # UI only; /api/run needs the function, use netlify dev
npx netlify dev            # UI and /api/run together, on port 8888
npm test
npm run lint
npm run typecheck
npm run build
```

The tests never reach a provider. The test config blanks every key, and the server tests stub `fetch`.

## Live URL

https://jdgafx-app-13-langgraph-map-reduce.netlify.app

## Known limits

- The model layer is tested with mocked replies only. No live provider run has been made. Extract and check send no reasoning or JSON-mode option, so their replies depend on the prompt and on tolerant parsing, and that behaviour is unverified.
- Extract output is capped at 400 tokens. A reply that is cut short, or that holds no readable JSON object, counts as a missed chunk and is retried once.
- The check call is a second opinion. If it fails for any reason, coverage falls back to chunk citations, the trace says so, and the summary is kept.
- The rate limit is in memory. Each warm function instance counts separately, so the real limit scales with the number of instances.
- Costs are OpenRouter's reported figures when present. Otherwise they are estimates from the list prices above.
- The sample text was entered by hand from the 1776 text and has not been diffed against an archival copy. The tests check its key passages and its nine-chunk split.
- Streaming depends on the function host returning a streamed response. If the stream ends without a result or an error frame, the browser writes the message itself: "The run ended before a result was ready. Please try again." The server does not send that message.
