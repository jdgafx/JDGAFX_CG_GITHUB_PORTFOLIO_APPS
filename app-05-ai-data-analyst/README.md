# DataPilot: AI Data Analyst

DataPilot answers a plain-English question about a CSV file and draws the chart that answers it. You pick a live public dataset or upload your own CSV (up to 5 MB, with a header row). The live datasets are fetched from their public APIs in your browser at the moment you pick them. The model never sees the whole file. It reads the column names and up to five sample rows, then returns a query plan: the column to group by, the column to measure and how to total it. Your browser runs that plan on every row, so the numbers come from your data. The page states the answer in one sentence, draws the chart, and shows each run step with its timing, tokens, cost and the model that served the reply.

**What this showcases:** the model plans, the browser computes. A query plan is validated against the columns and executed deterministically over every row.

Live: https://jdgafx-app-05-ai-data-analyst.netlify.app

## Data

Nothing is bundled. Each live dataset is fetched from a public API with CORS enabled, parsed in the browser, and shown with its source link, row count and fetch time. A loading state, an error message with a Retry button, and a Fetch again button cover slow, failed and empty responses.

| Dataset | Source | What the page does with it |
|---|---|---|
| Earthquakes, past 7 days (default) | USGS `all_week.csv`, about 2,000 rows | Adds a `region` column from `place` (the text after the last comma, with the USGS codes CA and MX written out as California and Mexico). |
| Earthquakes, past 30 days | USGS `all_month.csv`, about 10,600 rows and 2 MB | Same as above. |
| Daily weather, last 12 months | Open-Meteo archive API, one of eight cities | Strips the metadata block above the real header, renames the columns to `date`, `temp_max_c`, `temp_min_c` and `precipitation_mm`, and adds a `month` column (YYYY-MM). The window is the 12 months ending yesterday, computed from today's date. |
| Your CSV | A file you choose | Parsed in the browser. Nothing is uploaded. |

The week feed is the default because it is small (about 400 KB, a second or two to load) and complete under the row limit. The city list in `src/lib/liveData/catalog.ts` is configuration. The model sees only the column names and up to five sample rows. The browser computes every answer over all rows.

## Page layout

The page is a bench. The controls sit on the left: your data (a sample or an uploaded CSV), then the question. The run sits on the right. It shows the result first, with the answer above its chart and the query plan in plain words under the answer. Below the result come the data preview, the model and cost figures, the agent run steps and the question history. Below 1000 px the controls stack above the run.

## Agent steps

The agent run section lists these steps in order. A step that did not run is marked skipped.

| Step | Where | What it does |
|---|---|---|
| Build request | server | Builds the prompt from the column names, the sample rows and the question. |
| Model call | server | Sends one chat request to the fixed model. Shows the served model, tokens and cost. |
| Read JSON reply | server | Reads the JSON object from the reply, even when prose or a code fence surrounds it. |
| Check plan against columns | server | Rejects any column, chart type, calculation, filter or sort that the dataset or chart cannot use. |
| Repair turn | server | If the check failed, sends the model its rejected reply and the reason, once. Skipped when the first plan passes. |
| Send request | browser | Used only when no server trace came back, for example when the network fails. |
| Run plan on the rows | browser | Filters, groups, sorts and totals every row in the browser. |
| Check plan in the browser | browser | Repeats the column check before drawing. It normally passes. |

The agent run section shows each step's status and duration, and the tokens and cost of each model call. The model and cost section shows the metrics for the run: total latency, prompt, completion and total tokens, cost in USD, and the served model. The token counts and cost appear only when the provider reports them. Otherwise the page says "not reported".

## Architecture

- **Browser** (React and Vite): parses the CSV, sends the question, column names, up to five sample rows and the row count to `/api/ai`, then runs the returned plan with `src/lib/dataEngine.ts`.
- **Netlify Function** at `/api/ai` (`netlify/functions/ai.ts`): checks the origin, method, rate limit, body size and every field. It calls the model once, plus at most one repair turn, and returns the plan with its trace.
- **Model provider**: OpenRouter chat completions. Only `netlify/shared/provider.ts` calls it.
- **Keys**: `OPENROUTER_API_KEY` is set in the Netlify site environment and read on the server only. The browser never receives it.
- **Model rule**: one constant, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned, in `netlify/shared/provider.ts`. A request cannot choose a model, and the page has no model picker. Every call sends a token cap (`max_tokens`) and `usage: { include: true }`.
- **Input checks**: `netlify/shared/requestBody.ts` rejects a body over 128 KB, a question over 2,000 characters, more than 200 columns or names over 200 characters, more than five sample rows, cells over 200 characters, and a row count outside 0 to 20,000. The browser trims sample cells to the same limit, so a valid upload is never refused. The limits live in `src/lib/limits.ts`.
- **Plan check**: `src/lib/queryPlan.ts` accepts only the listed chart types, calculations, filter comparisons and sort directions, and only real column names. It runs on the server and again in the browser.
- **Rate limit**: 20 requests per minute per client address. Each warm function instance keeps its own count, so this blunts casual use but is not a shared quota.
- **Time budget**: the server gives one 25-second budget to the whole request, including the empty-reply retry and the repair turn. The browser stops waiting after 30 seconds.
- **Retries**: one retry when the model returns an empty reply. One repair turn when the plan fails the column check and at least 8 seconds remain. A reply cut off by the token cap is not retried.
- **Errors**: every failure returns one plain sentence, shown in an error notice. Provider 401, 402 and 403 answers read "The AI provider rejected the key or is out of credit." A provider 429 answers 429 with a one-minute hint. Provider 5xx answers and timeouts read "The AI provider did not answer in time." Provider bodies and key material are never shown.
- **Status codes**: 400 for a bad request, 403 for a foreign origin, 405 for a non-POST, 413 for a large body, 422 for a plan that still fails after the repair turn, 429 for rate limits, 500 for a missing server key or an unexpected error, 502 for provider failures and unusable replies, 504 for a provider timeout. Errors found before the model call return only the message.

## Run locally

```bash
npm ci
npm run dev          # the UI at http://localhost:5173
npx netlify dev      # the UI and the function together at http://localhost:8888
```

`npm run dev` serves the UI only. Its proxy sends `/api` requests to port 8888, so run `npx netlify dev` for a working analysis.

Environment variables (names only):

- `OPENROUTER_API_KEY`: required by the function. Set it in your shell or with the Netlify CLI. Never commit it.
- `ALLOWED_ORIGINS`: optional, comma-separated. Netlify's own `URL` and `DEPLOY_PRIME_URL` are added automatically.

Checks:

```bash
npm test             # unit tests and function tests; no live model calls
npm run lint
npm run typecheck
npm run build
```

Every key is blanked in `vitest.config.ts`, and the function and data-loading tests stub `fetch`, so the tests never reach a provider or the public APIs.

## Code map

- `netlify/functions/ai.ts`: the endpoint and the run pipeline.
- `netlify/shared/`: the provider call, its error mapping, and request validation.
- `src/lib/liveData/`: `catalog.ts` (datasets, cities, request URLs, the 12-month window), `parse.ts` (the USGS and Open-Meteo parsers and the derived columns) and `load.ts` (the timed fetch and its error copy).
- `src/hooks/useLiveDataset.ts`: loads the chosen dataset, abandons a request when you switch, and retries on demand.
- `src/components/DataSection.tsx` and `DataSourcePanel.tsx`: the dataset pickers and the source, rows and freshness panel.
- `src/lib/dataEngine.ts`: CSV parsing, filtering, grouping, totals, sorting and the top group. It runs a plan that `queryPlan.ts` has already validated.
- `src/lib/queryPlan.ts`: the plan check.
- `src/lib/api.ts`: the browser client and its error copy.
- `src/lib/answer.ts`: the one-sentence answer, built from the engine's top group, and the query plan in plain words.
- `src/components/RunColumn.tsx`: the run column (result, data preview, model and cost, agent run, history).
- `tests/unit/` and `tests/server/`: the tests. `tests/fixtures/` holds short recorded excerpts of the two live responses, used only by tests.

## Known limits

- Stop aborts the browser request. The server call may still finish, and its tokens may still be billed.
- The model sees column names and up to five sample rows, never the full file. The browser computes results from every row.
- The notice about a missing column comes from the model's reply. The browser does not read the question's wording, so a missing or wrong notice is possible.
- Replies arrive in one piece. The app does not stream.
- Charts show at most 20,000 rows of a file, 30 bar groups and 8 pie slices. Sums and counts fold the smallest groups into "Other". Averages, minimums and maximums leave them off the chart, and a note says so.
- Cost and token counts appear only when the provider reports them.
- The repair turn is a second model call, and it is billed. It runs only when the first plan fails the column check.
- The live datasets depend on the providers being up. Open-Meteo's archive lags a few days, so the last days of the window can hold blank cells, which the page reports as ignored.
- USGS writes most US places as "State" and a few as a two-letter code. Only CA and MX are mapped, so another code, if USGS used one, would show as its own region.
- Question history lives in the page for one session and is lost on reload.
