# app-13-langgraph-map-reduce (GraphSwarm)

GraphSwarm is a document analyst built on LangGraph.js. Load a Wikipedia article, or paste a document, of 200 to 20,000 characters. The graph splits the text into chunks, extracts key points from every chunk in parallel, merges them, writes a structured summary whose points cite chunk numbers, and checks coverage. If a chunk was missed, that chunk is re-run once. The run finishes with a coverage count, the summary, and a trace of every model call with its served model, tokens and cost.

**What this showcases:** a LangGraph map-reduce: many parallel extractions, one synthesis that cites its chunks, and a coverage check that re-runs only what was missed.

The graph is the point of the app. A plain chain runs one call after another. This app needs a fan-out to a variable number of parallel branches (one per chunk), a reducer that merges branch results, and a conditional loop that sends only the missed chunks back for one more pass. LangGraph's `Send` and conditional edges express that directly, and the state reducers keep the parallel writes from colliding.

## The graph

```
START
  |
split ---- fan out: one Send per chunk (conditional edge) ----+
  |                                                           |
  |        extract x N, parallel, all at once (claude-haiku-5.5)          <-----+
  |                                                           |
  +<----------------------------------------------------------+
  |
reduce        merge findings, deduplicate entities (no model)
  |
synthesize    one cited summary (anthropic/claude-haiku-5.5)
  |
check         chunk-id coverage, plus one advisory review call (anthropic/claude-haiku-5.5)
  |
  +-- missing chunks and retries < 1 --> Send extract for the missing chunks only
  |                                        |
  |                                        v
  |                             reduce -> synthesize -> check   (retries is now 1)
  |                             (reduce goes straight to final when the retry found
  |                              nothing new or under 6 s of budget remain)
  |
  +-- otherwise -----------------------> final -> END
```

Conditional edges:

- After `split`: one `Send('extract', { chunk, total, pass: 1 })` per chunk.
- After `check`: when some chunks are missing and `retries` is below 1, one `Send('extract', { chunk, total, pass: 2 })` per missing chunk. Otherwise the run goes to `final`.

Cycles and limits:

- One cycle only. The retry runs at most once, after a 0.5 s pause, and only for chunks that are missing. It starts only if at least 11 s of the run budget remain. Otherwise the first-pass summary is kept and a notice says the retry was skipped to stay inside the time limit. The retry's extract calls time out after 5 s, the first pass's after 6 s, and the advisory review call after 5 s. After them, the second synthesis and check run only if the retry added a key point (or a chunk with key points still lacks a citation) and at least 6 s remain. Otherwise the first-pass summary is kept, with a notice. A retry never lowers coverage: after the second check, the second summary replaces the first only if it covers more chunks. On a tie or a loss the first-pass summary, coverage and flags are kept, and the notice and the check row in the trace say which one was kept and the two counts.
- At most 12 chunks. A long text gets larger chunks, not more of them.
- Up to 12 extract calls run at once. 12 is also the chunk cap, so every chunk runs at the same time. A lower limit would make the rest wait inside the request.
- Each model call times out after 10 s unless it has a shorter limit, as above. The limit does not depend on how `fetch` handles an abort: the call is raced against a plain timer, so a request that hangs, a response body that never finishes, or a fetch that ignores its signal is cut at the limit, and a late reply is dropped. A call that times out costs its chunk only. If the budget itself ends while a node is still running, the run is ended one second later, whatever that node is doing. When a run does run out of time the message says so and asks the visitor to try again, and adds "A shorter text also helps." only for a text over 10,000 characters. The whole run has a 23 s budget, so the server always ends the stream itself, with a result or an error message and then [DONE], before the platform closes the function. The live Netlify site was seen closing it at about 30 s, although the documented limit is 60 s. The budget clock starts after about 3 s of start-up and network, so 23 s ends near 26 s as the browser sees it.

Every node uses one model, `anthropic/claude-haiku-5.5` on OpenRouter, set once in `netlify/shared/models.ts`. It is pinned to that version on purpose, not to the family alias. The roles differ only by output cap and JSON mode. OpenRouter list price is $0.10 in and $0.50 out per 1M tokens, which matches the cost it reported for live calls (checked 2026-10-09).

| Node | Max output tokens | JSON mode | Why |
| --- | --- | --- | --- |
| extract (one call per chunk) | 800 | no | Live replies used 311 tokens at the median and 495 at most, so 800 never cut one off |
| check (one call per run) | 300 | yes | The reply is `{"omitted": [...]}`, about 12 tokens. Without JSON mode Haiku wrote a chunk-by-chunk review in prose and hit the cap |
| synthesize (one call per pass) | 1500 | yes | Live summaries used 875 to 1,209 tokens. At a 1200 cap one call in ten was cut off and the provider closed its JSON early, silently dropping the last points |

Every call sets `usage: { include: true }`, so OpenRouter reports its cost. When a call reports no cost, the app estimates it from the list price above and labels the figure "estimated".

No call sends a temperature. Haiku 5.5 does not accept one when every parameter must be honoured: a request with a temperature and `provider.require_parameters` gets a 404 "No endpoints found", and a test pins that no request body carries a temperature. Every call turns reasoning off (`reasoning: { enabled: false }`). Left on, Haiku spent 380 to 475 hidden tokens on a synthesis call, which cut the JSON off and made the call take 4 to 6 s instead of 3. Synthesis also routes only to providers that accept every parameter it sends. Extract and check replies are read tolerantly: the first complete JSON object in the reply is used, whether it sits in a code fence, after prose, or both.

Measured against the live model on 2026-10-09 (84 extract calls and 10 full runs for the percentiles): extract p50 2.3 s, p95 3.9 s, max 4.6 s except one call that hung to the 10 s limit; check p50 1.1 s, p95 2.0 s; synthesis p50 4.1 s, p95 7.0 s. A nine-chunk run took 8 to 11 s without a retry. In a final set of ten runs with the limits above (five loaded articles, five pasted 12-chunk texts), seven covered every chunk on the first pass, the retry ran in three of them and finished in 17.7 to 20.6 s, and nine of ten ended with every chunk covered.

## What the UI shows

- **Wikipedia loader.** The visitor types an article title or a few words. After a short pause the app searches en.wikipedia.org (`list=search`) and offers matching titles; Load, or a click on a match, fetches the article as plain text (`prop=extracts&explaintext=1`, redirects followed) straight from the browser, since the API answers CORS requests with `origin=*`. Three suggested titles (Apollo 11, Photosynthesis, Rubber duck) load the same way. Only the titles are stored in the app, the text is fetched live. Section headings stay as short lines, and the end-matter sections (See also, References, External links and similar) are dropped. A longer article is cut at the last paragraph break under 10,000 characters (the loader limit, half the paste limit), and the card under the input says so, with the article's full length. The card also shows the title as a link to the article and the character count. An article under 200 characters is refused with its length. A missing article, a disambiguation page (with matching articles offered), a timeout (15 s for an article, 8 s for a search), an unreachable or unavailable Wikipedia, and an unreadable reply each show a clear message, and the transient ones offer "Try again". The code is in `src/lib/wikipedia.ts` (pure URL building, reply reading, cleaning, trimming) and `src/lib/wikipedia-api.ts` (the fetches).
- **Controls.** A document text area with a character counter that the loader fills or the visitor pastes into, an "Analyze document" button that runs the analysis on the text in the box, and a "Stop the run" button. The loader and Analyze stay disabled while a run is in progress. Stop is enabled only during a run, and it stops the run in this tab.
- **Status.** A badge in the header and a status line above the graph use the same words as the buttons: Ready, Analyzing, Finished, Failed, or Stopped. While analyzing, the status line names the current step and keeps the last one through the short gaps between steps.
- **Graph.** The split node fans out to one node per chunk. Each chunk node shows its state as a dot and a word: Waiting until a slot opens, then Running, and a retried chunk shows as Retried. The fan converges into reduce, then synthesize, check and final. Taken paths stay in the accent colour after the run. The check node has a labelled loop back to the fan: "Retry N missing chunks" (or "Retry 1 missing chunk") when a retry ran, or "Coverage complete" when none did. A step that never started reads Not run once the run is over, and a step the time limit cut off reads Failed.
- **Readout.** Total time, total tokens, total cost, the extract and check calls' cost, with the count of those same calls, against the synthesis call's cost, and the models used with the number of calls each role made. Each model id stays on one line.
- **Summary.** Each point shows a "Chunk n" badge for every chunk it came from. A point without a valid citation shows no badge. The entities found across the document follow.
- **Coverage.** A line such as "9 of 9 chunks covered". A chunk counts as covered when it gave key points and the summary cites it, and nothing else decides that. Any chunk still missing is listed with its reason: no key points found, or not cited in the summary. If the review model thinks a covered chunk is thin in the summary, a muted note says so. The note never changes the count and never starts a retry. If the retry pass does not finish, the first-pass summary is shown with a notice that says why. The badge beside the count says what happened to the retry: "No retry needed", "1 retry used", "1 retry used, first pass kept" (the retry ran but covered no more chunks), or "Retry not completed". The missing line reads "Still missing after the retry" once a retry ran to the end.
- **Trace.** One numbered row for each finished step, with its milliseconds, the served model, tokens and cost. Each extract chunk has its own row. Steps still running appear at the end of the list.

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
- Each run builds its own graph, limiter and budget, so no state is shared between requests. The graph is compiled without a checkpointer, because this app never resumes or inspects a run.

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

- The tests use mocked model replies only. Extract sends no JSON-mode option, so its replies depend on the prompt and on tolerant parsing.
- Extract output is capped at 800 tokens. A reply that is cut short, or that holds no readable JSON object, counts as a missed chunk and is retried once.
- The check call is a second opinion and does not verify facts. Its flags only add a note. If it fails for any reason, the trace says so and the summary is kept, because coverage never depended on it.
- The model can misread who does what to whom when it extracts or summarizes. The prompts tell it to keep each actor and object as the text gives them, but it can still swap them, and nothing in the run checks a statement against the source.
- The rate limit is in memory. Each warm function instance counts separately, so the real limit scales with the number of instances.
- Costs are OpenRouter's reported figures when present. Otherwise they are estimates from the list prices above.
- Wikipedia text is read as the API's plain extract. Tables, lists and image captions can come through as short lines, and the app does not check them. The loader needs the browser to reach en.wikipedia.org, and a long article is cut to its first 10,000 characters, so the summary covers the start of it, not the whole. The loader trims to 10,000 so a run fits Netlify's time limit: that gives about 8 or 9 chunks.
- Pasted text may be up to 20,000 characters, which can make 12 chunks. A 12-chunk run uses most of the 23 s budget. In live runs against real models, some chunks were missed on the first pass and the retry was skipped for lack of time, so coverage read 9 or 10 of 12. The coverage line reports that as it is. Loaded articles are trimmed to 10,000 characters to avoid this.
- The browser does not wait forever for the stream. It gives up when no byte has arrived for 30 s, or when the run has lasted 35 s (the server ends a run at 23 s plus a 1 s grace), and shows "The connection stopped answering. No summary was written. Analyze again to retry." Stop stays a silent Stop.
- Streaming depends on the function host returning a streamed response. If the stream ends without a result or an error frame, the browser writes the message itself: "The run ended before a result was ready. Please try again." The server does not send that message.
- Stop ends the stream in this tab only. The function may still finish calls it had already started.
