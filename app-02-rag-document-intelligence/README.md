# DocMind: document question answering with retrieval

DocMind answers questions about one PDF or TXT file. You upload the file, ask a question, and get an answer with the passages it used and their page numbers. The PDF is read in your browser. The browser picks the passages that share words with your question and sends only those to the model. Each answer shows the steps it ran, with timings, token counts, cost, and the model that served it.

Live URL: https://jdgafx-app-02-rag-document-intelligence.netlify.app

## The pipeline

The steps below are the trace names the UI shows, in the order they run.

1. **Retrieve passages** (browser). Ranks the document's passages by the share of distinct question words each contains. A small density bonus, always smaller than one word's share, orders passages that cover the same words. The top 20 go on to the server. If none shares a word with the question, the model is not called and the UI says so.
2. **Accept request** (server). Checks the question and the passage count. The step time includes the request checks made before it.
3. **Build prompt** (server). Adds the system prompt and the labelled passages, then reports the character count sent.
4. **Call model** (server). One chat call to the fixed model. The step reports which model served the reply.
5. **Retry model call** (server). Runs only when the first reply was empty or cut off at the output cap, and at least 5 seconds of the request budget remain. At most one retry.
6. **Parse and validate** (server). Reads the JSON reply, keeps only citations that name a passage that was sent, and reports the cited count and the self-rated percentage.

The Latest run card lists every step with its status, duration, and the tokens and cost of each model call. It also shows total latency, prompt, completion and total tokens, cost in USD, and the served model. A missing value reads "not reported". Cost is marked "estimated" when it comes from published catalogue prices rather than the provider's usage report.

Each answer shows its self-rated confidence as "Self-rated N%", with a note that the model rated its own answer and the rating is not checked against the passages. It also shows "Served by" and the source passages. Hovering a source marks its passages in the Passages card.

## Architecture

```
browser (React, pdf.js)
  -> PDF text read locally, passages chunked (500 characters, 50 overlap)
  -> term-overlap retrieval picks up to 20 passages
  -> POST /api/ai  (Accept: text/event-stream)
       Netlify Function netlify/functions/ai.ts
         -> origin check, method check, rate limit, body size, validation
         -> runAnswer (netlify/shared/answer.ts)
         -> OpenRouter chat completions (netlify/shared/provider.ts)
  <- server-sent events: start, step, result or error, then [DONE]
```

- **Keys.** `OPENROUTER_API_KEY` is read only inside the function. The browser never receives it and never calls OpenRouter.
- **Model.** One server constant, `~anthropic/claude-haiku-latest`. The UI has no model picker, and any model name the client sends is ignored.
- **Output cap.** Every model call sends `max_tokens: 4096` and `usage: { include: true }`, so the reply reports tokens and cost.
- **Validation.** Non-POST methods get 405. Bad JSON gets 400. Bodies over 256 KB get 413. The question is at most 2000 characters, at most 20 passages are accepted, and each passage must start with its `[Chunk N]` label. Each passage is cut to 2000 characters and the title to 200.
- **Rate limit.** 20 requests per minute per client address, kept in memory by each function instance. It is a cost guard, not a quota.
- **Deadline.** One 25-second budget covers the first call, any retry, and the price lookup. The price lookup is skipped when less than a second remains.
- **Errors.** Every failure returns a plain sentence in `{ error }`. A provider rate limit returns 429. Other provider failures return 502, and timeouts return 504. Provider response bodies are logged on the server only. The UI shows an error banner and marks the failed step in the trace.

## Run it locally

Requirements: Node.js with npm. The checks below were run on Node 22.

```bash
npm ci
npx netlify dev        # UI and function together, on http://localhost:8888
npm run dev            # UI only, on http://localhost:5173; questions need the function
```

Environment variables (names only):

- `OPENROUTER_API_KEY`: required for answers. Set it in your shell or in the Netlify site settings, never in the repository.
- `ALLOWED_ORIGINS`: optional, comma-separated extra browser origins allowed to call `/api/ai`.
- `URL`, `DEPLOY_PRIME_URL`, `DEPLOY_URL`: set by Netlify for the live site and deploy previews.

Checks:

```bash
npm test          # unit tests and function smoke tests; no provider call is made
npm run lint      # ESLint, zero warnings allowed
npm run typecheck # TypeScript project build, strict mode
npm run build     # typecheck, then the production bundle in dist/
```

The tests blank every provider key. Every function test replaces `fetch` with a stub before the handler runs, so no test reaches a provider.

## Known limits

- Retrieval matches words, not meaning. A question that uses different words from the document can find no passage, and then the model is not called.
- The model sees only the passages that matched. Text that shares no word with the question is never sent.
- The confidence figure is the model's own rating. It is not checked against the passages.
- Citations are checked against the passages that were sent. The answer text itself is not checked against them.
- The rate limit is kept in memory per function instance, so the true number of requests a site allows is higher than 20 per minute.
- Requests with no Origin header are accepted. The origin list stops other websites in a browser, not direct calls.
- A request with no Content-Length header is read in full before the size check runs. The platform's own request size limit bounds that read.
- Stop aborts the browser request. The server passes that abort to its model call when the platform reports the disconnect. If the platform does not, the model call completes and can still be billed.
- The model reply arrives whole. The server streams each step as it finishes, not the model's words.
- A PDF with no text layer, such as a scan, is rejected. There is no OCR.
- Files up to 25 MB are read in the browser. Large documents take longer to read and to rank.
- The server allows 25 seconds of model time per question. A slower reply, and a provider 5xx error, both end with "The AI provider did not answer in time."
- There is no labelled evaluation set, so retrieval quality is not measured.
