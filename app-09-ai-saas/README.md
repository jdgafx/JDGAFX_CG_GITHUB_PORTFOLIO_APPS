# InsightHub

Live: https://jdgafx-app-09-ai-saas.netlify.app

InsightHub is an analytics dashboard for npm packages. The visitor picks one to five packages, or one of the ready-made comparisons such as React vs Vue vs Svelte, and the browser loads their real daily downloads from the npm registry. It works out totals, per-day averages, the change between the latest half of the window and the half before it, the weekend pattern and each package's share, and draws them as charts. Generate insights then asks a model to write four or five insights about those figures.

What this showcases: a live analytics dashboard on public npm data, with a streamed AI analysis whose numbers are checked against the dashboard's own figures.

## Data

The source is the public npm downloads API, `https://api.npmjs.org/downloads/range/{start}:{end}/{package}`. It allows browser requests from any origin, so the page calls it directly and no server is involved. Nothing is stored or bundled: every visit fetches live counts.

- **One request per package.** The API's bulk form (`react,vue`) rejects any list that contains a scoped name, and a single request per package lets one failure show beside the packages that worked. Scoped names such as `@anthropic-ai/sdk` are encoded into one path segment.
- **The window ends on the latest published day.** npm publishes a day or two late and reports the unpublished days as zero. The page asks for the window plus seven days, finds the latest day on which any selected package has downloads, and shows the 30, 90 or 365 days ending there. The header says which dates are shown and how many days npm has not published yet.
- **Unreported days.** The API also returns zero for some days inside the window, for every package at once. When every selected package is at zero on a day, and the selection normally moves at least 100 downloads a day, that day is treated as an npm gap. It is left out of the averages and the change figures, and shows as a break in the line charts. The page lists those dates. A selection of very small packages keeps its zeros as real quiet days.
- **Figures.** Total is the sum over reported days. Per day is the total divided by the reported days. Change is per-day downloads in the latest half of the window against the half before it. Weekend vs weekday is downloads per day on Saturday and Sunday as a percentage of downloads per day on weekdays, by UTC date. Share is a package's part of the selection's total. The functions are pure and tested in `src/lib/analytics.ts`.
- **Charts.** Daily downloads, a 7-day moving average that removes the weekly cycle, and a share donut. A log-scale switch keeps a small package visible beside a large one.
- **States.** Loading, a package that is not on npm (with a Remove button), npm rate limiting, a network failure or timeout (10 seconds per request), a reply that is not the documented shape, and a partial failure where the other packages are shown with a note and a Retry button.

Generate insights sends only the computed figures for each package, not the daily numbers, to a server function. The function calls the model through OpenRouter and streams the answer back as it is written. On a desktop, the controls stay in a column on the left while the figures, the analysis and the charts scroll on the right. On a phone, the same parts stack.

## Agentic steps

The run trace lists these steps in order. Before a run, each row says what its step does. While a run is going, the step in progress is marked. The server times each step.

| Step | What it does | What the UI shows |
| --- | --- | --- |
| Build request | Builds the prompt from the summary figures that the request check has already accepted | Package count and the dates |
| Call model | Sends one chat request with the fixed model, a 1,024-token output cap, reasoning off and usage reporting on | Provider status and HTTP code |
| Stream answer | Forwards each text piece to the browser as it arrives | Chunk count, characters and tokens |
| Check figures | Matches each percentage, each download count (written in full, or as 1.2 billion or 41k) and each multiple (4.3 times, 11x) to the summary, rounded to the figure's own decimals. A change figure must also carry its direction | How many figures match, and the ones that do not |
| Validate output | Fails an answer the provider cut off before it finished, or an empty answer. Flags an answer cut at the output cap | Failure message, or cut-off warning |

Run metrics sit under the answer and show total latency, measured on the server, plus prompt, completion and total tokens, cost in USD, and the served model. These come from the provider's response. A value the provider did not report reads "not reported".

The status line reads "Analysis complete" when a run finishes. It adds "with a failed check" when a step failed, for example a figure that is not in the summary. A failed check does not mean the run failed.

## Architecture

Browser (React, Vite) to `POST /api/ai` (Netlify Function, `netlify/functions/ai.ts`) to OpenRouter chat completions.

- **Keys.** `OPENROUTER_API_KEY` is read only by the function. It is never sent to the browser, logged, or written into a response.
- **Model.** One server constant, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), in `netlify/shared/provider.ts`. The browser cannot choose a model, and a model field in the request is ignored. There is no model picker. The model is pinned to Haiku 5.5, which rejects `temperature`, so the request never sends one.
- **Validation.** The function checks the origin allowlist (403), the method (405), a rate limit of 20 requests per minute per client (429), the body size of 32,000 bytes (400), the provider key (500 when `OPENROUTER_API_KEY` is not set), JSON (400), and the summary (400, naming the field): one to five packages, each name a valid npm name and not repeated, real dates that match the window length, and every figure a finite number inside its range. If Content-Length is missing, the whole body is read before the size check. That relies on Netlify's 6 MB limit on buffered request payloads.
- **Timeouts.** One 25-second deadline covers the provider call and the stream after it. When the deadline ends a stream, the provider body is cancelled, so a stream that never closes cannot hold the run. The browser also gives up after 40 seconds if the stream stops without closing.
- **Errors.** Provider 401 and 403, 402, 429, 5xx and errors inside the stream map to plain sentences. The browser shows only those sentences. Provider response bodies are never sent to the browser or logged. A stream that ends without `[DONE]` or a finish reason fails the run with a cut-off message.
- **Retries.** None. Each run makes one model call. Generate insights again starts a new run.
- **Stop.** Stop aborts the browser request, which closes the stream.

Shared modules in `netlify/shared/`: `contract.ts` (the summary type and the npm package-name rule, imported by the browser as well so the two sides cannot drift), `insights.ts` (prompt, figure check, request validation), `stream.ts` (reading the provider stream and writing browser frames), and `provider.ts` (model constant, endpoint, request body).

Browser modules in `src/lib/`: `npm.ts` (URL, reply parser, fetching with timeouts and error kinds), `analytics.ts` (window, gaps, totals, change, weekend pattern, moving average), `dates.ts`, `format.ts`, `api.ts` (the insights stream) and `insightRun.ts` (run state tied to the summary it was started for, so changing the selection clears a stale answer).

## Run locally

1. `npm ci`
2. `npm run dev` runs the UI only. The dashboard and its charts work, because the browser reads npm directly. The dev server forwards `/api` to port 8888, where only `netlify dev` listens, so Generate insights reports that the service could not be reached.
3. `npx netlify dev` runs the UI and the function together on port 8888. Set these variables first. Names only:
   - `OPENROUTER_API_KEY`: required for insights.
   - `ALLOWED_ORIGINS`: optional, comma-separated extra browser origins.
4. Checks, each run from this folder:
   - `npm test` runs the unit tests and the function smoke tests. Provider and npm calls are stubbed, and the test configuration blanks the provider key. The npm reply fixture in `tests/unit/npm.test.ts` is a recorded shape, used only by the tests.
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`

## Known limits

- npm download counts include CI runs, mirrors and repeated installs. They measure install volume, not users.
- Package names follow the rules for new packages: lowercase, with an optional scope. Old packages with uppercase letters in their names cannot be selected.
- npm's counts have gaps of their own. The page marks a day as unreported only when every selected package is at zero on it.
- The page needs npm to be reachable from the browser. When it is not, the dashboard shows the failure and a Retry button instead of data.
- The figure check tests percentages, download counts and multiples between packages only. A figure matches only when a summary value, rounded to the figure's own decimals, equals it.
- Direction is read from a minus or plus sign attached to a figure, or from a fixed list of rise and fall words among the four words before it in the same sentence. Other phrasing, such as "off 13.5%", is not checked for direction. A level such as a share or the weekend ratio is never checked for direction.
- A claim that uses no new number passes the figure check, because the check does not judge conclusions.
- Stop aborts the browser request. The function cancels its provider call only when the platform reports the closed stream, so the provider call may run to completion.
- The rate limit is kept in memory for each function instance. It is a cost guard, not a hard quota.
- Requests with no Origin header are accepted, subject to the rate limit. These are non-browser callers.
- Netlify's synchronous execution limit for functions is 60 seconds, and a site cannot change it. The app's 25-second deadline sits under that limit, so a slow provider gets the timeout message before the platform stops the function.
- The model's answer is not checked for accuracy. The output checks test only whether the answer is empty, cut off, or contains figures that are not in the summary.
