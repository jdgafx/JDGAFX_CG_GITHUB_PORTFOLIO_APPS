# ModelArena (app-06-llm-playground)

ModelArena sends one prompt to three models at the same time and shows what each one returned: the answer, the latency, the output tokens, the cost, and the model that served it. Panel A always runs the fixed alias `~anthropic/claude-haiku-latest`. Panels B and C take any text model from the live OpenRouter catalogue, chosen from a grouped picker. An AI judge then gives one model's opinion on the three answers, and the page labels that note as opinion. Timings, tokens and cost are measured.

What this showcases: the same prompt measured on three models at once, with cost from the provider's usage and an AI judge's note labelled as opinion.

## Screen

From 1000px wide, the controls sit on the left and the results on the right. Below that, the controls stack above the results. The controls are the prompt (with a sample prompt, the options and the system prompt), the models (Panel A is fixed, and B and C come from the grouped picker), and the Compare, Stop and Clear buttons. The results hold, in order: the status line, Answers (three panels, each with its served model, answer, latency, output tokens and cost), Evidence (summary lines and a table of measures), AI judge (one model's opinion, in a dashed panel), Run totals, and Run trace.

## Agentic steps

A run makes up to four model calls. The run trace names them with these steps:

| Step | What it does | What the UI shows |
| --- | --- | --- |
| `Panel A request` | One chat call to the fixed alias. | Answer, served model, latency, output tokens, cost. |
| `Panel B request` | One chat call to the model picked for B. | The same fields. |
| `Panel C request` | One chat call to the model picked for C. | The same fields. |
| `Judge` | One chat call to the fixed alias. It reads the answers that came back and names the best one, with a short note per panel. Skipped when fewer than two panels answer. | The verdict, the judge model, and its time and tokens. |
| `Compare request` | Shown only when the compare call fails before any panel answers. | The plain-language error. |

The three panels run in parallel. Each one reports its own failure, so one failed panel does not stop the others. The Evidence section and its summary lines use only measured numbers: the fastest panel, the cheapest panel, and the panel with the most output tokens. Ties go to the earlier panel. The Run totals section shows the run time, which covers the compare request and the judge. Its token and cost totals cover the answering panels only. The judge's own tokens and cost appear on its trace step.

Cost comes from the billed amount that OpenRouter reports. When OpenRouter reports no cost for a panel, the server estimates it from that model's listed price and the measured tokens, if the model is listed, and labels it "estimated". The judge does not look up prices, so its cost reads "not reported" unless OpenRouter reports one. When neither is available, the page shows "not reported". A cost of zero is never shown unless OpenRouter reports zero.

## Architecture

The browser (React and Vite) calls three Netlify Functions. Each function calls OpenRouter at `https://openrouter.ai/api/v1`.

- `GET /api/models` (`netlify/functions/models.ts`) returns the grouped model list.
- `POST /api/compare` (`netlify/functions/compare.ts`) runs the three panels and returns one JSON reply.
- `POST /api/judge` (`netlify/functions/judge.ts`) returns the judge's verdict.

The server holds `OPENROUTER_API_KEY`. The key is read in `netlify/shared/openrouter.ts`. It is never sent to the browser, and this code never writes it to the logs. The model list is public, so it is fetched without a key.

**Model rule.** Panel A is fixed to `~anthropic/claude-haiku-latest`, and the server ignores the first model the browser sends. Panels B and C must be models the picker offers, and the server accepts exactly that set. The set is the curated IDs that the live list still shows, plus the other text models with a context of at least 32,000 tokens. Free, batch and router models are left out of both the picker and the accepted set. If the catalogue cannot be read, the server accepts only the curated IDs in `netlify/shared/curated.ts`. The picker's starting picks are checked against the loaded list. If a starting pick is missing from it, that slot switches to the first listed model. Compare stays disabled until both picks are listed.

**Validation.** Every POST is checked before any provider call, in this order: origin (403), method (405), rate limit (429), JSON (400), and body size (400). The body limits are 40,096 bytes for compare and 148,096 bytes for judge, and every body within the character limits fits. Then come the fields. The prompt is 1 to 4,000 characters, the system prompt is up to 2,000 characters, the temperature is from 0 to 1, and the three model IDs are up to 200 characters each, with B and C on the picker's list. For the judge there are one to three answers with unique slots. Each answer must be 8,000 characters or fewer, and all answers together must be 20,000 characters or fewer. Longer judge input is refused, not cut.

**Limits.** Each client IP can make 20 POST requests per minute on each warm function instance. This is a cost guard, not a hard quota. Each request has a budget of 24 seconds, and that budget is the real bound. Netlify's synchronous function limit is 60 seconds and cannot be configured, so the app returns well inside the platform limit. The catalogue fetch waits up to 10 seconds, and the cached list lasts 10 minutes. After a failed fetch, the server waits a minute before it tries again. A panel waits up to 25 seconds and the judge up to 20 seconds, each capped by what is left of the budget. Nothing is retried, because every provider call is billed.

**Errors.** A refused request returns `{ "error": "<plain sentence>" }` with a 400, 403, 405, 429, 503 or 500 status. A panel or judge failure returns 200 with the failure in the body. A failed panel shows its error in its column, and a failed judge returns `ok: false` with a reason. For those failures the messages are:

- 401 or 402: "The AI provider rejected the key or is out of credit"
- 429: "Rate limited, try again in a minute"
- 5xx or timeout: "The AI provider did not answer in time"
- Any other status: "The AI provider rejected the request (status N)"

A missing key returns 503 with no provider call. The server never falls back to another provider. An unexpected error returns a generic 500. In the browser, each error appears in a `role="alert"` notice, and the trace marks the failed step. The provider's own text goes to the function log only.

## Run locally

1. Run `npm ci`.
2. Run `npm run dev` to start the UI only. Requests to `/api` fail unless the functions run.
3. Run `npx netlify dev` to run the UI and the functions together on port 8888. Set `OPENROUTER_API_KEY` in your Netlify environment or your shell. Optional names: `ALLOWED_ORIGINS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`.

Checks:

- `npm test` runs the unit tests and the function smoke tests. Every provider and catalogue call is stubbed, and the test key is a placeholder, so no test reaches OpenRouter.
- `npm run lint` runs ESLint with zero warnings allowed.
- `npm run typecheck` and `npm run build` run the TypeScript and Vite builds.

Live site: https://jdgafx-app-06-llm-playground.netlify.app

## Known limits

- Stop aborts the browser request. The server call can still complete and bill, so a stopped run may still cost money.
- Nothing streams. Each panel's answer appears when that panel finishes.
- The judge gives one model's opinion. It is not a measurement. The app has no quality evals, so the Evidence numbers cover speed, cost and output length only.
- One prompt gives one sample per model. The result is a comparison, not a benchmark.
- When the catalogue is unreachable, B and C can take any curated ID without a live check. A model that the provider has since retired fails on its own panel.
- Cost is the billed amount OpenRouter reports, or an estimate from the listed price. An estimate appears only when it is above zero.
- The picker and the compare function each keep the model list in their own memory. After a model leaves the list, the picker can still offer it until its cache refreshes, and a compare request for that model then returns a 400.
- During an outage, the last good copy of the list is served and labelled "Cached model list" in the header.
- A judge request with answers totalling more than 20,000 characters is refused. This can happen when all three panels answer near the 2,048-token output cap, and the AI judge section then shows the refusal.
- The rate limit and the model-list cache apply per warm instance. A new model can take up to 10 minutes to appear.
- A panel that has not answered within its share of the 24-second budget is reported as not answering in time, even if the model would have replied later.
