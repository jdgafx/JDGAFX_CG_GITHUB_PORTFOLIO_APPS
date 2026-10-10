# BrowseBot

BrowseBot plans a web task and then carries it out in a real browser. You describe a task in plain language, such as "Open news.ycombinator.com and report the top three story titles." One model call turns it into a short list of browser steps. The planner is asked for two to six, and the server accepts up to ten. A headless Chromium inside the Netlify function then runs those steps on allowed sites and reports what it saw: the URL, the page title and the visible text, either of the whole page or of one region of it. The page shows a visual replay: one small picture of the real page per step, in a filmstrip, with the chosen step large beside the address, title and text the browser read at that moment. It also shows the plan, each step as it runs, the planner's served model, tokens and cost, and the session ID. BrowseBot does not decide whether the result answers your task.

The example tasks read live public pages: the Hacker News front page and its newest list, Wikipedia's featured article, and a Hubble Space Telescope infobox. Nothing in them is canned. The text shown is whatever the page held when the browser read it.

What this showcases: a planner that acts on the live web inside a bounded, allowlisted headless Chromium, with every observation shown as it happens.

## The agent steps

The planner makes one request, `POST /api/ai`. Its trace rows are:

- **Request built** measures the task and lists the allowed sites.
- **Check task sites** runs before the model call. It reads every host name or address written in the task and refuses the task with a 400 when one is outside the allowlist, so no model or browser call is made.
- **Model call** makes one chat request to OpenRouter. It retries once only when the answer is empty or cut off. The row shows the served model, the finish reason, tokens and cost.
- **Parse and validate** reads the JSON plan, checks each action, length limit, address and selector, and refuses any address outside the allowlist. A navigate step whose label names one site while its address opens another is refused. The planner may also return `{"refuse": "<reason>"}` when no allowed page can answer the task, and the server answers 400 with that reason. The planner is told never to open a different site in place of the one a task names.

The browser run follows. It streams server-sent events from `POST /api/execute`:

- **Launch browser** starts headless Chromium (`@sparticuz/chromium` driven by `playwright-core`) inside the function. On a cold function the row says how long unpacking Chromium took.
- **One row per planned step**, named like `Navigate: Google home page`, `Click: Search button`, `Type: search input`, `Extract: page title` or `Verify: results`. A row shows the planned thought, what the browser did, the time taken, and the URL it observed afterwards. `extract` and `verify` read the page. The planner's expected wording is never used as a result. An `extract` or `verify` step may carry a `selector`, a plain CSS selector for the part of the page to read. The browser then reports the visible text of the first 10 matching elements instead of the whole page text, and the row says `Read the text of <selector>`. If nothing matches, the row says so and the page text is shown instead. The server accepts a selector of at most 200 characters that is plain CSS, so `text=`, `xpath=` and `>>` chains are refused. The planner prompt lists selectors it can use for the example sites, such as `.titleline > a` for Hacker News story titles, `table.infobox` for a Wikipedia infobox and `#mp-tfa > p` for the featured article's blurb.
- **Read final page** records the URL, title and text at the end of the run.
- **Close browser** closes the browser and shows whether it closed. It comes before the run's final event and stays last in the trace.

The page has two columns. The controls hold the task, the allowed sites and the run buttons. The run column shows the plan beside the observed page, a run figures strip with the served model, prompt, completion and total tokens, cost in USD and total latency, and the numbered run trace. A figure the provider does not report shows as "not reported". Nothing is estimated. The observed page appears as a browser window with the URL, title and up to 4,000 characters of text, which is the region's text when the step named a selector, and the session ID beneath. A keyword overlap with the plan's expected wording is a lookup aid, not a verdict.

## How to use

A "How to use" block under the masthead says what the app does in one line and gives three steps that name the controls as they appear. Its **Try it: Hacker News top stories** button fills the task field with the first example and starts the same run as Plan and run, against the live front page. The block is open on the first visit and folds away while a result is shown, so the result keeps its place.

## Live data

The masthead carries a chip: "Live data: <host> via headless Chromium". It is hollow before a run. It lights up, with the fetch time, when the browser has read its first real page, and the host shown is the page's own. It turns to "Live data unavailable" when a run fails before any page was read. Every result on the page comes from a page the browser loaded during the run, and no sample results exist in `src/` or `netlify/` (a test checks for that). The example tasks are inputs only.

## Visual replay

After every step the server captures the page the browser is on and sends it with the step's result. Each picture is a JPEG about 640 px wide, taken over the Chrome DevTools protocol from a 960 by 540 browser window, so page text stays readable. The captured JPEG stays under 70 KB per picture (quality 60, then 42, 28 and 18 until it fits), and all pictures of one run stay under 450 KB, which is about 600 KB of base64 in the stream. A step with no room left, or whose capture fails, says so instead of showing a picture. A failed step keeps the picture of the page where it failed. A page on a site outside the allowlist is never captured.

On the page, the chosen step shows as a small browser window: the address and page title in its bar, the picture below it. Selecting the picture opens it at full size. Beside it are the plan, what the browser did and a box titled "What the browser read", which says so when a selector matched nothing and the whole page text is shown. Under both, a filmstrip shows one cell per step with its number, label and status, so a whole run of six steps is visible at once. Select a cell, drag the scrub bar or use the left and right arrow keys (Home and End jump to the ends) to look at a step. While a run is live the viewer follows the running step until you pick another one, and the Time figure counts up. Play replay and the scrub bar appear when a finished run has two or more pictures, and step through the run every 1.5 seconds. Pictures are checked on arrival: only a small base64 JPEG is shown.

The pictures travel in the same server-sent stream as the run, so the response is a streamed one: Netlify allows 20 MB and 60 seconds for streamed functions, and a run uses well under 1 MB.

## Architecture

Browser (React and Vite) calls the Netlify Functions `/api/ai` and `/api/execute`. The planner calls OpenRouter. The run starts a headless Chromium inside the `/api/execute` function and drives it with Playwright. No paid browser service is used.

- **Keys stay on the server.** `OPENROUTER_API_KEY` is read only inside the planner function. The browser never receives them.
- **Fixed model.** The planner always calls Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned, set once in `netlify/shared/provider.ts`. The browser sends no model name, and there is no model picker. Every planner request sends `max_tokens` (4096) and `usage: { include: true }`.
- **Allowlist.** `ALLOWED_DOMAINS` is a comma-separated list of hosts, and subdomains are included. Without it the list is `google.com, www.google.com, flights.google.com, en.wikipedia.org, news.ycombinator.com`. The planner prompt lists the same hosts, and the server checks every address again. After every step, before the page is read, the server checks the host the page is on and stops the run if that host is not allowed. localhost, `.local` names and private addresses are always refused, even if listed.
- **Request checks.** Only POST is accepted, apart from the browser's preflight. An origin that is not allowlisted gets 403. Bodies are capped at 8 KB for the planner and 32 KB for runs. A task is at most 500 characters. A plan has at most 10 steps. Text fields have length limits, and each action must be one of the six.
- **Rate limits.** The limits are 20 planner calls and 10 runs per minute per client address, per function instance. This is a cost guard, not a quota.
- **Time limits.** The planner has one 8.5 s deadline shared by its first call and any retry. Starting the browser waits up to 12 s, and opening a page and closing the browser each wait up to 7 s. Each browser action takes up to 3 s, a page load up to 8 s, a picture up to 4 s, and reading the page title takes up to 3 s. Reading the page text takes up to 1 s. A run starts no new step 30 s after the browser is ready.
- **Errors.** The server sends short plain sentences. Provider responses, stack traces and keys are never shown. A run that fails still closes its browser, and a close that fails is shown in the trace. Every failure leaves a failed row in the trace.

## Run locally

1. `npm ci`
2. `npm run dev` starts the page only. Its `/api` calls fail unless the functions run too.
3. `npx netlify dev` starts the page and the functions. It needs these environment variable names: `OPENROUTER_API_KEY`. The optional names are `ALLOWED_DOMAINS` and `ALLOWED_ORIGINS`. Set them in Netlify or your shell, and never commit them. A local run calls the real providers and is billed.
4. Checks: `npm test` stubs every provider call and needs no network, and its fixtures are recorded shapes, not app data. Then run `npm run lint`, `npm run typecheck` and `npm run build`.

Live site: https://jdgafx-app-10-browser-agent.netlify.app

## Known limits

- A picture is the top of the page in a 960 by 540 window, not the whole page. Text lower on the page is in the observed text but not in the picture, and text covered by a banner is in the observed text but hidden in the picture. The Wikipedia donation banner did this on the main page during checks: the featured article text was read, and the picture shows the banner over it.
- A step that leaves the page exactly as the step before it sends no new picture. The server compares each JPEG with the last one sent, names the earlier step instead, and the page tags it "Same page as step N". Such a repeat uses none of the run's picture budget.
- The picture is taken just after the text was read, so the two can differ when the page changed in between, such as a banner that appears late.
- Pictures are not stored. They exist for the length of the run on screen.
- The client ends a run stream that sends no byte for 30 s, or that lasts longer than 70 s, with a message to run the plan again. The server stops starting steps 30 s after the browser is ready.
- The planner call has its own 4.5 s limit and is retried once when it times out or drops, if budget remains within the 8.5 s planning budget. The trace row says "Retried once". Answers with an error status are never retried.
- Stop ends the browser stream. The server stops at the next step boundary and closes the browser. A step already running finishes or times out first. The page cannot receive the close result after Stop, so the trace adds a skipped Close browser row that says so.
- No new step starts 30 s after the browser is ready. Starting the browser takes about 0.4 s when the function is warm and about 2.9 s on a cold function, which unpacks Chromium. Netlify allows a streamed function 60 s and 20 MB (docs.netlify.com, function configuration and API pages), and a run uses a small part of both.
- A browser that does not close in time is left to end with the function, and the trace says so.
- Chromium needs memory: the function runs with Netlify's default 1,024 MB. A page that is very heavy could exceed it. The example sites use well under that.
- A navigation to a site outside the allowlist is refused by the browser before any request is made. A click that starts one reports "The page moved to <host>, which is outside the allowed sites."
- Chromium runs with `--single-process` and each browser leaves two folders in /tmp (a profile and artifacts) that Playwright does not remove. In a function container, /tmp is cleaned before every start and after every close: the Chromium files unpacked on the first run are kept and everything else in /tmp is removed. After each close the function also ends any Chromium process it started, and logs one line with /tmp room, the biggest /tmp entries by name, process counts and memory. The function never ends its own process. When /tmp still has under 150 MB free after cleaning, the run is refused with "The browser service is out of room. Try again in a moment." The browser runs with a 1-byte disk cache. A Chromium process outside this function's own tree is counted in the log line, never ended.
- When the run request fails with a server or gateway error, or the connection is cut, before any step finished, the page starts the run again once, after 0.8 s, and the trace says "Retried once". Other failures are not retried. A server error on the run shows "The browser service failed. Try again."
- The whole page text is read inside the page and cut there. A heavy page that takes over 3 s to lay out reports "The page text did not read in time."
- A request without a content-length header is read in full before its size is checked. The platform's own request size limit bounds that read.
- A click that opens a new tab is not followed. The run keeps reading the first tab.
- Rate limits are per function instance and best effort. Requests without an Origin header, such as curl, pass the origin check and rely on the per-address limit.
- The example tasks were run against the live sites with the real Chromium build the function ships, locally through the function itself. The deployed function has to be checked after each deploy.
- Google search results pages showed a bot check page to a local Chrome, so there is no example task for them. A task that asks for one reports whatever page the browser reached.
- A failed step ends the run. There is no replanning, and the planner never sees what the page looked like.
- The provider reports the planner's cost only. The browser costs nothing extra: it runs inside the function.
- The served model comes from the response and can differ from the one requested. The page shows the served model.
- The page shows the default allowlist. When `ALLOWED_DOMAINS` is set, the server enforces that list instead, but the page does not show it.
