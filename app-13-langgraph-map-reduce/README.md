# app-13-langgraph-map-reduce (GraphSwarm)

GraphSwarm is a document analyst built on LangGraph.js. Load a Wikipedia article, or paste a document, of 200 to 20,000 characters. The graph splits the text into chunks, extracts key points from every chunk in parallel, merges them, writes a structured summary whose points cite chunk numbers, and checks coverage. If a chunk was missed, that chunk is re-run once. The run finishes with a coverage count, the summary, and a trace of every model call with its served model, tokens and cost. The summary comes with a coverage map: one cell per chunk, shaded by how many summary points cite it. Select a point to see the chunks it cites and the sentences in them that best support it. Select a chunk to see which points cite it and what was extracted from it.

**What this showcases:** a LangGraph map-reduce: many parallel extractions, one synthesis that cites its chunks, and a coverage check that re-runs only what was missed.

The graph is the point of the app. A plain chain runs one call after another. This app needs a fan-out to a variable number of parallel branches (one per chunk), a reducer that merges branch results, and a conditional loop that sends only the missed chunks back for one more pass. LangGraph's `Send` and conditional edges express that directly, and the state reducers keep the parallel writes from colliding.

## The graph

```
START
  |
split ---- fan out: one Send per chunk (conditional edge) ----+
  |                                                           |
  |        extract x N, parallel, all at once (one model alias)     <-----+
  |                                                           |
  +<----------------------------------------------------------+
  |
reduce        merge findings, deduplicate entities (no model)
  |
synthesize    one cited summary (one model alias)
  |
check         chunk-id coverage, plus one advisory review call (one model alias)
  |
  +-- missing chunks and retries < 1 --> Send extract for the missing chunks only
  |                                        |
  |                                        v
  |                             reduce -> synthesize -> check   (retries is now 1)
  |                             (reduce goes straight to final when the retry found
  |                              nothing new or under 10 s of budget remain)
  |
  +-- otherwise -----------------------> final -> END
```

Conditional edges:

- After `split`: one `Send('extract', { chunk, total, pass: 1 })` per chunk.
- After `check`: when some chunks are missing and `retries` is below 1, one `Send('extract', { chunk, total, pass: 2 })` per missing chunk. Otherwise the run goes to `final`.

Cycles and limits:

- One cycle only. The retry runs at most once, after a 0.5 s pause, and only for chunks that are missing. It starts only if at least 17 s of the run budget remain (0.5 s pause, about 5.5 s for a retry extract call, the 10 s a second synthesis and check need, and 1 s of margin). Otherwise the first-pass summary is kept and a notice says the retry was skipped to stay inside the time limit. The retry's extract calls time out after 8 s, the first pass's after 9 s, and the advisory review call after 7 s. After them, the second synthesis and check run only if the retry added a key point (or a chunk with key points still lacks a citation) and at least 10 s remain. Otherwise the first-pass summary is kept, with a notice. A retry never lowers coverage: after the second check, the second summary replaces the first only if it covers more chunks. On a tie or a loss the first-pass summary, coverage and flags are kept, and the notice and the check row in the trace say which one was kept and the two counts.
- At most 12 chunks. A long text gets larger chunks, not more of them.
- Up to 12 extract calls run at once. 12 is also the chunk cap, so every chunk runs at the same time. A lower limit would make the rest wait inside the request.
- Each model call times out after 12 s (the synthesis call's limit) unless it has a shorter limit, as above. The limit does not depend on how `fetch` handles an abort: the call is raced against a plain timer, so a request that hangs, a response body that never finishes, or a fetch that ignores its signal is cut at the limit, and a late reply is dropped. A call that times out costs its chunk only. If the budget itself ends while a node is still running, the run is ended one second later, whatever that node is doing. When a run does run out of time the message says so and asks the visitor to try again, and adds "A shorter text also helps." only for a text over 10,000 characters. The whole run has a 23 s budget, so the server always ends the stream itself, with a result or an error message and then [DONE], before the platform closes the function. The live Netlify site was seen closing it at about 30 s, although the documented limit is 60 s. The budget clock starts after about 3 s of start-up and network, so 23 s ends near 26 s as the browser sees it. Thinking is on for every call and makes each one about 2.5 s slower, which changes the per-call limits above but not the platform's cut-off, so the budget stays at 23 s. A first pass is now estimated at 14 to 17 s (it was 8 to 11 s), so the retry rarely has the 17 s it needs and the first-pass summary is usually what is returned. Every chunk is still extracted: all 12 calls still run at once.

Every node requests one model, the OpenRouter alias `~anthropic/claude-haiku-latest`, set once in `netlify/shared/models.ts`. The trace and chips show the model OpenRouter answered with (the `model` field of each reply), never the alias. The roles differ only by output cap and JSON mode. Thinking is on: no call sends a reasoning option, so Haiku uses its default. Thinking tokens count toward the output cap, so each cap leaves room for about 500 of them above the answer. The code holds no price table and names no served model id (a test pins that).

| Node | Max output tokens | JSON mode | Why |
| --- | --- | --- | --- |
| extract (one call per chunk) | 2,500 | no | Live replies used 311 tokens at the median and 495 at most, plus about 500 of thinking, with 1,500 to spare |
| check (one call per run) | 2,000 | yes | The reply is `{"omitted": [...]}`, about 12 tokens, so the cap is nearly all thinking room. Without JSON mode Haiku wrote a chunk-by-chunk review in prose and hit the cap |
| synthesize (one call per pass) | 3,500 | yes | Live summaries used 875 to 1,209 tokens, plus about 500 of thinking. At a 1,200 cap one call in ten was cut off and the provider closed its JSON early, silently dropping the last points |

Every call sets `usage: { include: true }`, so each reply carries its token counts.

Prices come from OpenRouter's public model list, `https://openrouter.ai/api/v1/models` (no key). The server starts fetching it when a run starts, keeps the parsed prices in memory for an hour per function instance, and reads `pricing.prompt` and `pricing.completion` (USD per token) for the model each reply names in its `model` field. A call's cost is its prompt and completion tokens times those two prices. If a reply carries no `model` field, the call shows its tokens and "served model not reported" with no price. If the list cannot be fetched (or does not carry the served model), the call shows its tokens and "price unavailable". There is no fallback table. The readout names the served model id and its price per 1M tokens, and a trace row's cost shows the same on hover. A run total appears only when every answered call was priced. The tier OpenRouter lists above 100,000 prompt tokens is not read: a run holds at most 20,000 characters. The list is fetched by the server, never by the browser. The tests read a recorded copy of the list, `tests/fixtures/openrouter-models.json`, which is a test fixture only.

No call sends a temperature. Haiku 5.5 does not accept one when every parameter must be honoured: a request with a temperature and `provider.require_parameters` gets a 404 "No endpoints found", and a test pins that no request body carries a temperature. No call sends a reasoning option (thinking stays on), and a test pins that no request body carries `reasoning.enabled === false`. Haiku spent 380 to 475 thinking tokens on a synthesis call, which is why the caps above leave room for them and why a call takes about 2.5 s longer. Only the reply's `message.content` is parsed (text blocks only, if it is an array); reasoning fields beside it are ignored, and a test pins that. Synthesis also routes only to providers that accept every parameter it sends. Extract and check replies are read tolerantly: the first complete JSON object in the reply is used, whether it sits in a code fence, after prose, or both.

Measured against the live model on 2026-10-09 (84 extract calls and 10 full runs for the percentiles): extract p50 2.3 s, p95 3.9 s, max 4.6 s except one call that hung to the 10 s limit; check p50 1.1 s, p95 2.0 s; synthesis p50 4.1 s, p95 7.0 s. A nine-chunk run took 8 to 11 s without a retry. In a final set of ten runs with the limits above (five loaded articles, five pasted 12-chunk texts), seven covered every chunk on the first pass, the retry ran in three of them and finished in 17.7 to 20.6 s, and nine of ten ended with every chunk covered. Those figures were taken with thinking off. With thinking on the limits are set from them plus about 2.5 s per call (the middle of the 1 to 3 s that 380 to 475 thinking tokens added to a synthesis call): extract about 4.8 s at the median and 6.4 s at p95, check 3.6 s and 4.5 s, synthesis 6.6 s and 9.5 s. These are estimates, not live measurements, and should be re-measured.

## What the UI shows

- **Wikipedia loader.** The visitor types an article title or a few words. After a short pause the app searches en.wikipedia.org (`list=search`) and offers matching titles; Load, or a click on a match, fetches the article as plain text (`prop=extracts&explaintext=1`, redirects followed) straight from the browser, since the API answers CORS requests with `origin=*`. Three suggested titles (Apollo 11, Photosynthesis, Rubber duck) load the same way. Only the titles are stored in the app, the text is fetched live. Section headings stay as short lines, and the end-matter sections (See also, References, External links and similar) are dropped. A longer article is cut at the last paragraph break under 10,000 characters (the loader limit, half the paste limit), and the card under the input says so, with the article's full length. The card also shows the title as a link to the article and the character count. An article under 200 characters is refused with its length. A missing article, a disambiguation page (with matching articles offered), a timeout (15 s for an article, 8 s for a search), an unreachable or unavailable Wikipedia, and an unreadable reply each show a clear message, and the transient ones offer "Try again". The code is in `src/lib/wikipedia.ts` (pure URL building, reply reading, cleaning, trimming) and `src/lib/wikipedia-api.ts` (the fetches).
- **Controls.** A document text area with a character counter that the loader fills or the visitor pastes into, an "Analyze document" button that runs the analysis on the text in the box, and a "Stop the run" button. The loader and Analyze stay disabled while a run is in progress. Stop appears only during a run, and it stops the run in this tab.
- **Status.** A badge in the header and a status line under the buttons use the same words as the buttons: Ready, Analyzing, Finished, Failed, or Stopped. While analyzing, the status line names the current step and keeps the last one through the short gaps between steps.
- **Graph.** Drawn as SVG in the family's graph language, in a wide and a narrow layout (the narrow one below 720 px, so the whole graph fits a phone). The split node fans out to one node per chunk. Each chunk node shows its state as a dot and a word: Waiting until a slot opens, then Running, and a retried chunk shows as Retried. The fan converges into reduce, then synthesize, check and final. Taken paths stay in the accent colour after the run. The check node has a labelled loop back to the fan: "Retry N missing chunks" (or "Retry 1 missing chunk") when a retry ran, or "Coverage complete" when none did. A step that never started reads Not run once the run is over, and a step the time limit cut off reads Failed.
- **Readout.** Total time, total tokens, total cost (priced from OpenRouter's list for the served model, with that model and its price named), the extract and check calls' cost, with the count of those same calls, against the synthesis call's cost, and the models used with the number of calls each role made. The time ticks while the run goes, and after a failure or a stop the figures spent so far stay on screen. Models show as chips.
- **Coverage map.** Above the summary, one cell per chunk. The shade shows how many summary points cite the chunk (four steps, relative to the most-cited chunk), and the cell also says it in words ("2 pts"), so colour is never the only signal. A chunk that is missing from the summary has a dashed red border and says why ("not cited" or "no key points"). A chunk that was extracted twice carries a small retry mark. Cells are buttons; Left, Right, Home and End move between them.
- **Summary and source panel.** Each point is a button and still shows its "Chunk n" badges. Selecting a point lights up its cited chunks in the strip and opens a source panel with each cited chunk's text, with the one or two sentences that share the most content words with the point marked. Selecting a chunk shows the points that cite it (each opens its own source), the key points the extraction found in it, and its text. Escape closes the panel. On a phone the panel opens under the selected point. A point without a valid citation says so and shows no source. The entities found across the document follow.
- **How the sentences are chosen.** `pickSentences` in `src/lib/evidence.ts` is a pure function: lower-case content words (letters and digits, three or more characters, no stop words, a plural "s" removed), a sentence scores one per distinct word it shares with the point, a sentence needs at least one, a second needs at least half the best score, ties go to the earlier sentence, at most two are marked. It is a guide to where the support is, not proof of it. If no sentence shares a word, the panel says so.
- **Where the chunk text comes from.** Nothing extra goes over the wire except each chunk's key points (a few lines per chunk), which the browser posts back to the second request with the text. The page keeps the text it sent and cuts it with the same `splitText` function the split node uses (`netlify/shared/chunk.ts`, imported by the page), so chunk numbers and boundaries match the server's. The page keeps its own copy of the analyzed text, so editing the box after a run does not change the map, and it refuses to show chunk text if the chunk count differs from the server's.
- **Coverage.** The headline counts key points, not chunks: "22 of 37 key points used". Every extracted key point has an id (`1.2` is the second point of chunk 1; code assigns it after the extract calls, never the model). After the writer finishes, one check call per chunk (together, thinking on) reads the numbered summary sentences and that chunk's key points and says which sentence states which point; a point is used only when a sentence is found to state its main claim in full (a sentence that gives part of it, such as "releases oxygen" for "releases oxygen as a byproduct of water splitting", does not count), and ids that are not points of that chunk are dropped. So the headline can only read "all used" when every point is stated. The key points the summary does not use are listed under "Key points not used in the summary", each with its id and text. A review call sees only those points and says which of them state something central to the document's main subject; those are marked "May be central". The review never edits the summary, the count or the retry, it is not called when every point is used, and it is skipped (and the list says so) when too little of the run budget is left. If a chunk's check call fails, its points are listed as not used and the page names the chunk. A secondary badge counts chunks: "7 of 7 chunks cited" means the writer cites at least one point of each chunk, which is not the same as using every point. Any chunk with no cited point is listed with its reason: no key points found, or not cited in the summary. If the retry pass does not finish, the first-pass summary is shown with a notice that says why. The badge beside the counts says what happened to the chunk retry: "No chunk retry needed", "1 retry used", "1 retry used, nothing new", "1 retry used, first pass kept", or "Retry not completed". The check is a model's judgment of what a sentence states, one call per chunk; it is not a proof.
- **Trace.** One numbered row for each finished step, with its milliseconds, the served model, tokens and cost. Each extract chunk has its own row, and each row has a bar on a shared time axis, so the parallel chunks visibly overlap. Steps still running appear at the end of the list.

## Architecture

```
browser (React, Vite)
  -> POST /api/run         { text }               Netlify Function (netlify/functions/run.ts), request 1
       origin check, rate limit (20 per minute per client), body byte cap,
       field check (200 to 20,000 characters), OPENROUTER_API_KEY read on the server only
       split, extract (one call per chunk), reduce
  <- text/event-stream frames, a `handoff` frame holding the merged key points, then [DONE]
  -> POST /api/synthesize  { text, merged }       Netlify Function (netlify/functions/synthesize.ts), request 2
       the same guards, then the hand-off is checked field by field (netlify/shared/guard.ts)
       synthesize, review, final
  <- text/event-stream frames, a `result` frame, then [DONE]
       -> LangGraph StateGraph (netlify/shared/graph.ts) -> OpenRouter chat completions
```

- **Why two requests.** With thinking on, request 2's work is synthesis (9.2 to 12.0 s in SP2, 10.4 s and 8.4 s in the last runs), then the key point check (the nine calls of one run took 1.2 to 5.4 s) and the review (3.1 to 3.4 s), after an extract phase of 3.5 to 5.6 s. That is 22 to 25 s in one request, against a 23 s run budget inside the roughly 30 s platform cut-off. Each request has its own 23 s budget, and synthesis gets a 15 s timeout in request 2 that still leaves 8 s for the check. A prompt that made the writer cite key point ids itself was tried first and abandoned: its synthesis took 12.6 to 17.5 s, was cut off at 16.0 s and 21.0 s, and once spent all its tokens thinking. `src/lib/api.ts` runs both requests and presents them as one run: the rows of both are totalled for the metrics, and Stop ends whichever is running.
- **Request 2 trusts nothing the browser sends back.** Request 1 ends with a signed hand-off: the merged key points and a SHA-256 of the exact text it read and the time it was issued, under an HMAC seal whose key is derived from the provider key (`netlify/shared/handoff.ts`). The browser holds it unread and posts it back with the text. Request 2 refuses, with a plain 400 and before any model call, a seal that is not this server's (compared in constant time), a text whose hash differs, a seal older than 5 minutes, and a hand-off of another version, so a client cannot invent key points that the summary would present as extracted from the document. A correctly signed hand-off is checked again field by field (`guard.ts`): the server splits the text itself, so every chunk number must be one of its chunks, once, in order, every point id must be the id its position gives, every point and entity must fit the limits an extraction reply is held to, and the findings are rebuilt from the point texts and merged again. Entities and the finding count are never read from the body. Both requests have the same origin check, rate limit and byte cap.
- **Request 1 retries an empty chunk.** When a chunk's extract comes back with nothing usable (no key points, not JSON, empty, cut off or no answer), request 1 asks for that chunk once more, together with any other such chunk, as long as the pause, the retry call limit and a 1 s margin fit what is left of its 23 s budget (`MIN_EXTRACT_RETRY_BUDGET_MS`, 9.5 s; request 1 used 2.9 to 7.3 s in live runs). Both attempts have rows and count in the totals. The signed hand-off lists the retried chunks, so request 2 starts with its one retry spent and the page reads "1 retry used".
- **One production path.** The deployed functions run request 1 (`phase: 'extract'`), and request 2 (`phase: 'synthesize'`), and the tests of the analysis run that pair (`tests/helpers/split.ts`). `runPipeline` with the default `phase: 'all'` and `createRunHandler()` without a phase run the whole graph in one request. That is for in-process use and for tests of single nodes; production never runs it, and the timing and coverage figures in this file come from the split pair.
- **Totals count every billed call.** A reply that was refused (cut off, empty, not JSON, no key points) still has a usage block: its row carries the tokens and cost and the totals include them, for every attempt of a retry, and also when the run fails (the page shows what was spent before the failure). A call that was made but never answered (a timeout, a dropped connection, an abort) has no usage: its row says "not reported", and the total reads "at least $0.0012 (1 call not reported)". The page adds the rows of both requests, so a failed request 2 still shows what request 1 cost.
- The key lives only in the function's environment. The browser never sees it, and error text never includes a provider body.
- A rejected key, or an out-of-credit account, halts every parallel call at once. A rate limit, a timed-out call, a server error or a refused request costs that chunk only, and the retry may recover it. If the first pass cannot produce a summary, the run ends with one error frame. If the retry pass fails for any reason, including a halt, the first-pass summary is returned with a notice. The coverage review is the exception: a provider error there is swallowed, the summary is kept, and the trace marks the review as failed.
- Every run ends with `data: [DONE]`, including after a failure.
- Each run builds its own graph, limiter and budget, so no state is shared between requests. The graph is compiled without a checkpointer, because this app never resumes or inspects a run.

The result carries `keyPoints` (each chunk's merged key points, with ids) for the coverage map. Frames: `node_start`, `node_end`, `edge`, `handoff` (request 1 only; the page never sees it), `result`, `error`, then `[DONE]`.

## Run locally

Environment variable names, not values: `OPENROUTER_API_KEY` (required), and `ALLOWED_ORIGINS` (optional, comma-separated extra origins).

```
npm ci
npm run dev                 # UI only; /api/run and /api/synthesize need the functions, use netlify dev
npx netlify dev            # UI and both functions together, on port 8888
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
- Extract output is capped at 2,500 tokens (thinking included). A reply that is cut short, or that holds no readable JSON object, counts as a missed chunk and is retried once.
- The check call is a second opinion and does not verify facts. Its flags only add a note. If it fails for any reason, the trace says so and the summary is kept, because coverage never depended on it.
- The model can misread who does what to whom when it extracts or summarizes. The prompts tell it to keep each actor and object as the text gives them, but it can still swap them, and nothing in the run checks a statement against the source.
- The rate limit is in memory. Each warm function instance counts separately, so the real limit scales with the number of instances.
- Costs are tokens times OpenRouter's listed price for the served model. They are not the figure OpenRouter bills: in one live cross-check the reported cost was 1% below the listed price times the tokens (2.3364e-05 against 2.36e-05 USD).
- Wikipedia text is read as the API's plain extract. Tables, lists and image captions can come through as short lines, and the app does not check them. The loader needs the browser to reach en.wikipedia.org, and a long article is cut to its first 10,000 characters, so the summary covers the start of it, not the whole. The loader trims to 10,000 so a run fits Netlify's time limit: that gives about 8 or 9 chunks.
- Pasted text may be up to 20,000 characters, which can make 12 chunks. A 12-chunk run uses most of the 23 s budget, and with thinking on a first pass leaves under 10 s. In live runs against real models, some chunks were missed on the first pass and the retry was skipped for lack of time, so coverage read 9 or 10 of 12. The coverage line reports that as it is. Loaded articles are trimmed to 10,000 characters to avoid this.
- The browser does not wait forever for the stream. It gives up when no byte has arrived for 30 s, or when the run has lasted 60 s (the server ends a run at 23 s plus a 1 s grace; the cap is generous on purpose, because two correct runs finished at 32.7 s on a lossy network and the 30 s idle timer catches real stalls), and shows "The connection stopped answering. No summary was written. Analyze again to retry." Stop stays a silent Stop.
- Streaming depends on the function host returning a streamed response. If the stream ends without a result or an error frame, the browser writes the message itself: "The run ended before a result was ready. Please try again." The server does not send that message.
- Stop ends the stream in this tab only. The function may still finish calls it had already started.
