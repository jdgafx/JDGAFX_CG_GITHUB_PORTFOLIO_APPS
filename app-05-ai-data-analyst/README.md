# DataPilot: AI Data Analyst

DataPilot answers a plain-English question about a CSV file and draws the chart that answers it. Then you keep going: ask a follow-up such as "only Alaska", "now by month", "show the top 5" or "as a line chart", and the model returns a new plan from the one on screen. The page shows what changed as chips, runs the new plan on every row, and keeps each step in an analysis thread you can reopen. You pick a live public dataset or upload your own CSV (up to 5 MB, with a header row). The live datasets are fetched from their public APIs in your browser at the moment you pick them. The model never sees the whole file. It reads the column names and up to five sample rows, then returns a query plan: the column to group by, the column to measure and how to total it. Your browser runs that plan on every row, so the numbers come from your data. The page states the answer in one sentence, draws the chart, and shows each run step with its timing, tokens, cost and the model that served the reply.

**What this showcases:** the model plans, the browser computes, and a follow-up refines the plan instead of starting over. Every plan, first or refined, is validated against the columns and executed deterministically over every row.

## Follow-ups

After an answer, the follow-up box under the thread sends your words together with the plan on screen (and the question that made it). The server checks that plan against the same columns again and rebuilds it, so a tampered plan is refused with a 400. The model returns a complete new plan, and the same plan check runs on the server and again in the browser. Then:

- **Plan diff.** `src/lib/planDiff.ts` compares the old and new plan and shows chips: filter added, changed or removed, grouping, measure, chart type, sort, threshold ("having") and group limit ("top 5"), or "Plan unchanged".
- **Thread.** Each step keeps its question, chips, answer, chart and run trace. Choose any step to open it again; a follow-up asked from an earlier step refines that step and is marked "Refines step N". A new question in the rail starts a new thread; the one you leave moves to "Earlier analyses".
- **A follow-up that cannot apply says why.** If the data cannot answer it (for example "compare with last week" on a 7-day feed), the model returns the previous plan unchanged with a reason. The step is marked "Not applied", shows the reason, and the previous chart stays.
- **Several row conditions.** A plan holds one `filter` and up to three `moreFilters` that must all hold, so "magnitude 2.5 and above" then "only Alaska" narrows rather than replaces.
- **Export.** "Download CSV" saves every group of the open result (spreadsheet formula characters are written as text). "Download PNG" draws the open chart at twice its size with the chart's own colours.
- **Direction and limits follow your words.** "Lowest", "fewest", "coldest" and "bottom" rank ascending, "most", "top" and "highest" descending, from the wording of the latest question, not from the model's sort. A question that names both ends ("the most and the fewest") answers both. A model-set limit is kept only when the question names a number or an end ("top 5"), or when it was already in the plan before.

Live: https://jdgafx-app-05-ai-data-analyst.netlify.app

## Data

Nothing is bundled. Each live dataset is fetched from a public API with CORS enabled, parsed in the browser, and shown with its source link, row count and fetch time. A loading state, an error message with a Retry button, and a Fetch again button cover slow, failed and empty responses.

| Dataset | Source | What the page does with it |
|---|---|---|
| Earthquakes, past 7 days (default) | USGS `all_week.csv`, about 2,000 rows | Adds a `region` column from `place` (the text after the last comma, with the USGS codes CA and MX written out as California and Mexico). |
| Earthquakes, past 30 days | USGS `all_month.csv`, about 10,600 rows and 2 MB | Same as above. |
| Daily weather, last 12 whole months | Open-Meteo archive API, one of eight cities | Strips the metadata block above the real header, renames the columns to `date`, `temp_max_c`, `temp_min_c` and `precipitation_mm`, and adds a `month` column (YYYY-MM). The window is the 12 whole calendar months before the current one, computed from today's date, so no month is a partial month and months compare fairly. |
| Your CSV | A file you choose | Parsed in the browser. Nothing is uploaded. |

The week feed is the default because it is small (about 400 KB, a second or two to load) and complete under the row limit. The city list in `src/lib/liveData/catalog.ts` is configuration. The model sees only the column names and up to five sample rows. The browser computes every answer over all rows. Answers use plain words for the live datasets (`src/lib/vocabulary.ts`): "number of earthquakes", "total rain: 123.4 mm", "daily high temperature". An uploaded CSV keeps its own column names and says "rows".

## Page layout

The page is a bench in the shared design system v3 (app 05, the pink signal). The rail on the left holds the question, the Plan and run button, the examples and the data. The run is on the right, and the analysis thread leads it: each step with its question, change chips and answer, and the follow-up box under it. The open step's chart sits right under the thread on the v3 chart frame (direct value labels, the accent as series 1, grid and axis classes from `components.css`), then the live figures, the agent run as a waterfall, earlier analyses and the data preview. Below 1000 px the rail stacks above the run. Failed and stopped runs show a state block with a way to retry.

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

On a follow-up the "Build request" step also sends the previous plan, and "Run plan on the rows" is skipped when the model declines the follow-up.
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
- **Plan check**: `src/lib/queryPlan.ts` accepts only the listed chart types, calculations, filter comparisons, sort directions and threshold comparisons, and only real column names. A plan can carry a `filter` and `moreFilters` (tests on single rows before grouping), a `having` (a threshold on each group's total, average or count, applied after grouping), a `limit` (the first N groups after the sort) and, on a follow-up the data cannot answer, a `cannotApply` reason. It runs on the server and again in the browser.
- **Rate limit**: 20 requests per minute per client address. Each warm function instance keeps its own count, so this blunts casual use but is not a shared quota.
- **Time budget**: the server gives one 25-second budget to the whole request, including the empty-reply retry and the repair turn. The browser stops waiting after 30 seconds.
- **Per-call limit and retry**: each model try is cut at 6 seconds (1.5 times the slowest of 24 live plan calls, whose median was 1.7 s and p95 2.6 s). A try that times out or loses the connection is repeated once while at least 6 seconds of the run budget remain, and the trace says "Retried once because the first try ran out of time." An HTTP error answer from the provider and a stop by the visitor are never retried.
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
- `src/lib/answer.ts`: the one-sentence answer, built from the engine's results (top group, both ends, ties, top-N lists), and the query plan in plain words.
- `src/lib/analysis.ts`: one planning round (ask, check, run) for a question or a follow-up.
- `src/lib/planDiff.ts`, `src/lib/followUps.ts`, `src/lib/vocabulary.ts`, `src/lib/export.ts`, `src/lib/chartGeometry.ts`: the plan diff chips, the follow-up ideas, the dataset words, CSV and PNG export, and the chart geometry.
- `src/hooks/useAnalysisThread.ts`: the threads, the open step, the pending run and Stop.
- `src/components/ThreadPanel.tsx`, `ChartFrame.tsx`, `ChartSvg.tsx`, `ReadoutStrip.tsx`, `RunTrace.tsx`, `RunColumn.tsx`: the thread, the chart frame, the live figures, the waterfall and the run column.
- `tests/unit/` and `tests/server/`: the tests. `tests/fixtures/` holds short recorded excerpts of the two live responses, used only by tests.

## Known limits

- A follow-up refines one plan at a time. The plan has one grouping and one measure, so a comparison that needs two series ("compare with last week") is declined with a reason, not drawn.
- The model decides how to read a follow-up. The browser checks every plan against the columns and recomputes it, but it cannot tell whether a valid plan is what you meant; the chips and the "How this was computed" panel show what was run.
- A bar chart of more than 20 groups is drawn as horizontal bars (HTML, not SVG), which have no PNG export; CSV still works.
- The PNG export draws the live chart through a canvas. Web fonts are not embedded in it, so its text uses the system sans-serif.
- Threads and history live in the page for one session. Uploaded CSVs are not checked for partial months; the live weather window is whole months only.
- Stop aborts the browser request. The server call may still finish, and its tokens may still be billed.
- The model sees column names and up to five sample rows, never the full file. The browser computes results from every row.
- The notice about a missing column comes from the model's reply. The browser does not read the question's wording, so a missing or wrong notice is possible.
- Replies arrive in one piece. The app does not stream, so the browser waits up to 30 seconds for the server's 25-second budget.
- Charts show at most 20,000 rows of a file, 30 bar groups and 8 pie slices. Sums and counts fold the smallest groups into "Other". Averages, minimums and maximums leave them off the chart, and a note says so.
- Cost and token counts appear only when the provider reports them.
- The repair turn is a second model call, and it is billed. It runs only when the first plan fails the column check.
- The live datasets depend on the providers being up. Open-Meteo's archive lags a few days, so the last days of the window can hold blank cells, which the page reports as ignored.
- USGS writes most US places as "State" and a few as a two-letter code. Only CA and MX are mapped, so another code, if USGS used one, would show as its own region.
