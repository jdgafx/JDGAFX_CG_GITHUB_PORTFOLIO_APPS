# BrowseBot

BrowseBot plans a web task and then carries it out in a real browser. You describe a task in plain language, such as "Open google.com and report the page title." One model call turns it into a short list of browser steps. The planner is asked for three to six, and the server accepts up to ten. A Browserbase cloud browser then runs those steps on allowed sites and reports what it saw: the URL, the page title and the visible text. The page shows the plan, each step as it runs, the planner's served model, tokens and cost, and the session ID. BrowseBot does not decide whether the result answers your task.

## The agent steps

The planner makes one request, `POST /api/ai`. Its trace rows are:

- **Request built** measures the task and lists the allowed sites.
- **Model call** makes one chat request to OpenRouter. It retries once only when the answer is empty or cut off. The row shows the served model, the finish reason, tokens and cost.
- **Parse and validate** reads the JSON plan, checks each action, length limit and address, and refuses any address outside the allowlist.

The browser run follows. It streams server-sent events from `POST /api/execute`:

- **Open browser session** and **Connect browser** start a Browserbase session and attach to it over CDP.
- **One row per planned step**, named like `Navigate: Google home page`, `Click: Search button`, `Type: search input`, `Extract: page title` or `Verify: results`. A row shows the planned thought, what the browser did, the time taken, and the URL it observed afterwards. `extract` and `verify` read the page. The planner's expected wording is never used as a result.
- **Read final page** records the URL, title and text at the end of the run.
- **Release browser session** ends the Browserbase session and shows whether the release worked. It comes before the run's final event.

The page also shows a run summary with total latency, prompt, completion and total tokens, cost in USD, and the served model. A figure the provider does not report shows as "not reported". Nothing is estimated. The observed page panel shows the session ID, URL, title and up to 4,000 characters of page text. A keyword overlap with the plan's expected wording is a lookup aid, not a verdict.

## Architecture

Browser (React and Vite) calls the Netlify Functions `/api/ai` and `/api/execute`. The planner calls OpenRouter. The run calls Browserbase, which Playwright drives over CDP.

- **Keys stay on the server.** `OPENROUTER_API_KEY`, `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` are read only inside the functions. The browser never receives them.
- **Fixed model.** The planner always calls `~anthropic/claude-haiku-latest`, set once in `netlify/shared/provider.ts`. The browser sends no model name, and there is no model picker. Every planner request sends `max_tokens` (4096) and `usage: { include: true }`.
- **Allowlist.** `BROWSERBASE_ALLOWED_DOMAINS` is a comma-separated list of hosts, and subdomains are included. Without it the list is `google.com, www.google.com, flights.google.com`. The planner prompt lists the same hosts, and the server checks every address again. After every step, before the page is read, the server checks the host the page is on and stops the run if that host is not allowed. localhost, `.local` names and private addresses are always refused, even if listed.
- **Request checks.** Only POST is accepted, apart from the browser's preflight. An origin that is not allowlisted gets 403. Bodies are capped at 8 KB for the planner and 32 KB for runs. A task is at most 500 characters. A plan has at most 10 steps. Text fields have length limits, and each action must be one of the six.
- **Rate limits.** The limits are 20 planner calls and 10 runs per minute per client address, per function instance. This is a cost guard, not a quota.
- **Time limits.** The planner has one 8.5 s deadline shared by its first call and any retry. Each Browserbase request waits 7 s, with no SDK retries. Connecting, opening a page, closing the browser and releasing the session each wait up to 7 s, and a failed release is retried once. Each browser action takes up to 3 s, and reading the page title takes up to 3 s. Reading the page text takes up to 1 s. Each session is created with a 120 s duration cap. A run starts no new step after 15 s.
- **Errors.** The server sends short plain sentences. Provider responses, stack traces and keys are never shown. A run that fails still tries to release its browser session, and a release that fails twice is shown in the trace. Every failure leaves a failed row in the trace.

## Run locally

1. `npm ci`
2. `npm run dev` starts the page only. Its `/api` calls fail unless the functions run too.
3. `npx netlify dev` starts the page and the functions. It needs these environment variable names: `OPENROUTER_API_KEY`, `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`. The optional names are `BROWSERBASE_ALLOWED_DOMAINS` and `ALLOWED_ORIGINS`. Set them in Netlify or your shell, and never commit them. A local run calls the real providers and is billed.
4. Checks: `npm test` stubs every provider call and needs no network. Then run `npm run lint`, `npm run typecheck` and `npm run build`.

Live site: https://jdgafx-app-10-browser-agent.netlify.app

## Known limits

- The live site runs the build from before this finish pass until it is redeployed from git.
- Stop ends the browser stream. The server stops at the next step boundary and releases the session. A step already running finishes or times out first.
- No new step starts after 15 s, but a run can take longer, because creating, connecting, closing and releasing the session each wait up to 7 s. Whether Netlify keeps a streamed response open that long is not verified. The live check decides it.
- If a release fails twice, the session runs until its 120 s cap ends it. The cap is set when the session is created, and it is not verified live.
- A request without a content-length header is read in full before its size is checked. The platform's own request size limit bounds that read.
- A click that opens a new tab is not followed. The run keeps reading the first tab.
- Rate limits are per function instance and best effort. Requests without an Origin header, such as curl, pass the origin check and rely on the per-address limit.
- Only the google.com page-title task has been run live. Other presets and redirects are not verified live.
- A failed step ends the run. There is no replanning, and the planner never sees what the page looked like.
- The provider reports the planner's cost only. The browser session cost is not shown.
- The served model comes from the response and can differ from the one requested. The page shows the served model.
