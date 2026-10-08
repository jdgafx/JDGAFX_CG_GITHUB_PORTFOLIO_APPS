# InsightHub

Live: https://jdgafx-app-09-ai-saas.netlify.app

InsightHub is a SaaS analytics dashboard. It shows five summary figures and three charts over 30 days of API usage, then asks a model to write four or five insights about the summary. The data is a seeded demo dataset generated in the browser. It is not customer data. Visitors can sign in with Supabase when the project is configured, or use demo mode with no account.

Generate insights sends only the summary figures and their trends to a server function. The function calls the model through OpenRouter and streams the answer back as it is written.

## Agentic steps

The run trace lists these steps in order. The server times each one.

| Step | What it does | What the UI shows |
| --- | --- | --- |
| Build request | Builds the prompt from the summary figures that the request check has already accepted | Figure count and comparison window |
| Call model | Sends one chat request with the fixed model, a 1,024-token output cap, reasoning off and usage reporting on | Provider status and HTTP code |
| Stream answer | Forwards each text piece to the browser as it arrives | Chunk count, characters and tokens |
| Check figures | Matches each percentage, millisecond and dollar figure to the summary, rounded to the figure's own decimals. A trend figure must also carry its direction | How many figures match, and the ones that do not |
| Validate output | Fails an answer the provider cut off before it finished, or an empty answer. Flags an answer cut at the output cap | Failure message, or cut-off warning |

Run metrics below the trace show total latency, measured on the server, plus prompt, completion and total tokens, cost in USD, and the served model. These come from the provider's response. A value the provider did not report reads "not reported".

The status line reads "Analysis complete" when a run finishes. It adds "with a failed check" when a step failed, for example a figure that is not in the summary. A failed check does not mean the run failed.

## Architecture

Browser (React, Vite) to `POST /api/ai` (Netlify Function, `netlify/functions/ai.ts`) to OpenRouter chat completions.

- **Keys.** `OPENROUTER_API_KEY` is read only by the function. It is never sent to the browser, logged, or written into a response.
- **Model.** One server constant, `~anthropic/claude-haiku-latest`, in `netlify/shared/provider.ts`. The browser cannot choose a model, and a model field in the request is ignored. There is no model picker.
- **Validation.** The function checks the origin allowlist (403), the method (405), a rate limit of 20 requests per minute per client (429), the body size of 32,000 bytes (400), the provider key (500 when `OPENROUTER_API_KEY` is not set), JSON (400), and each metric as a finite number inside its range (400, naming the field). If Content-Length is missing, the whole body is read before the size check. That relies on Netlify's 6 MB limit on buffered request payloads.
- **Timeouts.** One 25-second deadline covers the provider call and the stream after it. When the deadline ends a stream, the provider body is cancelled, so a stream that never closes cannot hold the run. The browser also gives up after 40 seconds if the stream stops without closing.
- **Errors.** Provider 401 and 403, 402, 429, 5xx and errors inside the stream map to plain sentences. The browser shows only those sentences. Provider response bodies are never sent to the browser or logged. A stream that ends without `[DONE]` or a finish reason fails the run with a cut-off message.
- **Retries.** None. Each run makes one model call. Generate insights again starts a new run.
- **Stop.** Stop aborts the browser request, which closes the stream.

Shared modules in `netlify/shared/`: `insights.ts` (prompt, figure check, request validation), `stream.ts` (reading the provider stream and writing browser frames), and `provider.ts` (model constant, key lookup, request body).

## Run locally

1. `npm ci`
2. `npm run dev` runs the UI only. The dev server forwards `/api` to port 8888, where only `netlify dev` listens, so Generate insights reports that the service could not be reached.
3. `npx netlify dev` runs the UI and the function together on port 8888. Set these variables first. Names only:
   - `OPENROUTER_API_KEY`: required for insights.
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: optional. Vite reads them when it starts or builds. Without both, the app runs in demo mode only.
   - `ALLOWED_ORIGINS`: optional, comma-separated extra browser origins.
4. Checks, each run from this folder:
   - `npm test` runs the unit tests and the function smoke tests. Provider calls are stubbed, and the test configuration blanks the provider keys.
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`

## Known limits

- The data is a seeded demo dataset. A fixed seed generates it in the browser, so it is the same on every visit.
- The figure check tests numbers only. A figure matches only when the snapshot value, rounded to the figure's own decimals, equals it.
- Direction is read from a minus or plus sign attached to a figure, or from a fixed list of rise and fall words among the four words before it in the same sentence. Other phrasing, such as "off 13.5%", is not checked for direction. A level such as the error rate is never checked for direction.
- A claim that uses no new number passes the figure check, because the check does not judge conclusions.
- Stop aborts the browser request. The function cancels its provider call only when the platform reports the closed stream, so the provider call may run to completion.
- The rate limit is kept in memory for each function instance. It is a cost guard, not a hard quota.
- Requests with no Origin header are accepted, subject to the rate limit. These are non-browser callers.
- Netlify's synchronous execution limit for functions is 60 seconds, and a site cannot change it. The app's 25-second deadline sits under that limit, so a slow provider gets the timeout message before the platform stops the function.
- Sign-in with Supabase is not covered by the tests, because it needs a live project. Demo mode needs no account.
- The model's answer is not checked for accuracy. The output checks test only whether the answer is empty, cut off, or contains figures that are not in the summary.
