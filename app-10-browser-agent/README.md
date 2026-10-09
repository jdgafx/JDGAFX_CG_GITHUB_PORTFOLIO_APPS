# BrowseBot

BrowseBot plans a web task and then carries it out in a real browser. You describe a task in plain language, such as "Open news.ycombinator.com and report the top three story titles." One model call turns it into a short list of browser steps. The planner is asked for two to six, and the server accepts up to ten. A Browserbase cloud browser then runs those steps on allowed sites and reports what it saw: the URL, the page title and the visible text, either of the whole page or of one region of it. The page shows the plan, each step as it runs, the planner's served model, tokens and cost, and the session ID. BrowseBot does not decide whether the result answers your task.

The example tasks read live public pages: the Hacker News front page and its newest list, Wikipedia's featured article, and a Hubble Space Telescope infobox. Nothing in them is canned. The text shown is whatever the page held when the browser read it.

What this showcases: a planner that acts on the live web inside a bounded, allowlisted browser session, with every observation shown as it happens.

## The agent steps

The planner makes one request, `POST /api/ai`. Its trace rows are:

- **Request built** measures the task and lists the allowed sites.
- **Check task sites** runs before the model call. It reads every host name or address written in the task and refuses the task with a 400 when one is outside the allowlist, so no model or browser call is made.
- **Model call** makes one chat request to OpenRouter. It retries once only when the answer is empty or cut off. The row shows the served model, the finish reason, tokens and cost.
- **Parse and validate** reads the JSON plan, checks each action, length limit, address and selector, and refuses any address outside the allowlist. A navigate step whose label names one site while its address opens another is refused. The planner may also return `{"refuse": "<reason>"}` when no allowed page can answer the task, and the server answers 400 with that reason. The planner is told never to open a different site in place of the one a task names.

The browser run follows. It streams server-sent events from `POST /api/execute`:

- **Open browser session** and **Connect browser** start a Browserbase session and attach to it over CDP.
- **One row per planned step**, named like `Navigate: Google home page`, `Click: Search button`, `Type: search input`, `Extract: page title` or `Verify: results`. A row shows the planned thought, what the browser did, the time taken, and the URL it observed afterwards. `extract` and `verify` read the page. The planner's expected wording is never used as a result. An `extract` or `verify` step may carry a `selector`, a plain CSS selector for the part of the page to read. The browser then reports the visible text of the first 10 matching elements instead of the whole page text, and the row says `Read the text of <selector>`. If nothing matches, the row says so and the page text is shown instead. The server accepts a selector of at most 200 characters that is plain CSS, so `text=`, `xpath=` and `>>` chains are refused. The planner prompt lists selectors it can use for the example sites, such as `.titleline > a` for Hacker News story titles, `table.infobox` for a Wikipedia infobox and `#mp-tfa > p` for the featured article's blurb.
- **Read final page** records the URL, title and text at the end of the run.
- **Release browser session** ends the Browserbase session and shows whether the release worked. It comes before the run's final event.

The page has two columns. The controls hold the task, the allowed sites and the run buttons. The run column shows the plan beside the observed page, a run figures strip with the served model, prompt, completion and total tokens, cost in USD and total latency, and the numbered run trace. A figure the provider does not report shows as "not reported". Nothing is estimated. The observed page appears as a browser window with the URL, title and up to 4,000 characters of text, which is the region's text when the step named a selector, and the session ID beneath. A keyword overlap with the plan's expected wording is a lookup aid, not a verdict.

## Architecture

Browser (React and Vite) calls the Netlify Functions `/api/ai` and `/api/execute`. The planner calls OpenRouter. The run calls Browserbase, which Playwright drives over CDP.

- **Keys stay on the server.** `OPENROUTER_API_KEY`, `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` are read only inside the functions. The browser never receives them.
- **Fixed model.** The planner always calls Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned, set once in `netlify/shared/provider.ts`. The browser sends no model name, and there is no model picker. Every planner request sends `max_tokens` (4096) and `usage: { include: true }`.
- **Allowlist.** `BROWSERBASE_ALLOWED_DOMAINS` is a comma-separated list of hosts, and subdomains are included. Without it the list is `google.com, www.google.com, flights.google.com, en.wikipedia.org, news.ycombinator.com`. The planner prompt lists the same hosts, and the server checks every address again. After every step, before the page is read, the server checks the host the page is on and stops the run if that host is not allowed. localhost, `.local` names and private addresses are always refused, even if listed.
- **Request checks.** Only POST is accepted, apart from the browser's preflight. An origin that is not allowlisted gets 403. Bodies are capped at 8 KB for the planner and 32 KB for runs. A task is at most 500 characters. A plan has at most 10 steps. Text fields have length limits, and each action must be one of the six.
- **Rate limits.** The limits are 20 planner calls and 10 runs per minute per client address, per function instance. This is a cost guard, not a quota.
- **Time limits.** The planner has one 8.5 s deadline shared by its first call and any retry. Each Browserbase request waits 7 s, with no SDK retries. Connecting, opening a page, closing the browser and releasing the session each wait up to 7 s, and a failed release is retried once. Each browser action takes up to 3 s, and reading the page title takes up to 3 s. Reading the page text takes up to 1 s. Each session is created with a 120 s duration cap. A run starts no new step after 15 s.
- **Errors.** The server sends short plain sentences. Provider responses, stack traces and keys are never shown. A run that fails still tries to release its browser session, and a release that fails twice is shown in the trace. Every failure leaves a failed row in the trace.

## Run locally

1. `npm ci`
2. `npm run dev` starts the page only. Its `/api` calls fail unless the functions run too.
3. `npx netlify dev` starts the page and the functions. It needs these environment variable names: `OPENROUTER_API_KEY`, `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`. The optional names are `BROWSERBASE_ALLOWED_DOMAINS` and `ALLOWED_ORIGINS`. Set them in Netlify or your shell, and never commit them. A local run calls the real providers and is billed.
4. Checks: `npm test` stubs every provider call and needs no network, and its fixtures are recorded shapes, not app data. Then run `npm run lint`, `npm run typecheck` and `npm run build`.

Live site: https://jdgafx-app-10-browser-agent.netlify.app

## Known limits

- The live site runs the build from before this finish pass until it is redeployed from git.
- Stop ends the browser stream. The server stops at the next step boundary and releases the session. A step already running finishes or times out first. The page cannot receive the release result after Stop, so the trace adds a skipped Release row that says so.
- No new step starts after 15 s, but a run can take longer, because creating, connecting, closing and releasing the session each wait up to 7 s. Whether Netlify keeps a streamed response open that long is not verified. The live check decides it.
- If a release fails twice, the session runs until its 120 s cap ends it. The cap is set when the session is created, and it is not verified live.
- A request without a content-length header is read in full before its size is checked. The platform's own request size limit bounds that read.
- A click that opens a new tab is not followed. The run keeps reading the first tab.
- Rate limits are per function instance and best effort. Requests without an Origin header, such as curl, pass the origin check and rely on the per-address limit.
- The browser steps for the Hacker News (two), Wikipedia (two) and Google home page tasks were run against the live sites in a local Chrome through the same step and snapshot code. A run in a Browserbase session has not been checked for the new example tasks. GitHub is not on the default allowlist, because its pages took 0.9 to 7 s to load from a local connection and a page load over 3 s fails the navigate step. Redirects are not verified live.
- Google search results pages showed a bot check page to a local Chrome, so there is no example task for them. A task that asks for one reports whatever page the browser reached.
- A failed step ends the run. There is no replanning, and the planner never sees what the page looked like.
- The provider reports the planner's cost only. The browser session cost is not shown.
- The served model comes from the response and can differ from the one requested. The page shows the served model.
- The page shows the default allowlist. When `BROWSERBASE_ALLOWED_DOMAINS` is set, the server enforces that list instead, but the page does not show it.
