# InsightHub

Live: https://jdgafx-app-09-ai-saas.netlify.app

InsightHub is an analytics dashboard for npm packages. The visitor picks one to five packages, or one of the ready-made comparisons such as React vs Vue vs Svelte, and the browser loads their real daily downloads from the npm registry. It works out totals, per-day averages, the change between the latest half of the window and the half before it, the weekend pattern and each package's share, and draws them as charts. On the daily chart it marks the unusual days, looks up each package's release history in the npm registry and lists, for every unusual day, how far above normal it was and which releases came out just before it. Explain spikes then asks a model to write a short analysis of the figures and those days, and the page checks the numbers, dates and versions the model quotes against that evidence.

What this showcases: spikes explained. A robust spike detector on live npm downloads, matched to registry release history, with a streamed model explanation whose numbers, dates and versions are checked against that evidence.

## Data

The source is the public npm downloads API, `https://api.npmjs.org/downloads/range/{start}:{end}/{package}`. It allows browser requests from any origin, so the page calls it directly and no server is involved. Nothing is stored or bundled: every visit fetches live counts.

- **One request per package.** The API's bulk form (`react,vue`) rejects any list that contains a scoped name, and a single request per package lets one failure show beside the packages that worked. Scoped names such as `@anthropic-ai/sdk` are encoded into one path segment.
- **A year of history is always fetched.** Every request asks for the last 365 days plus seven, whatever window is shown, so spike detection has weeks of same-weekday baseline behind a 30-day view. The shown window is the last 30, 90 or 365 of them.
- **The window ends on the latest published day.** npm publishes a day or two late and reports the unpublished days as zero. The page asks for the window plus seven days, finds the latest day on which any selected package has downloads, and shows the 30, 90 or 365 days ending there. The header says which dates are shown and how many days npm has not published yet.
- **Unreported days.** The API also returns zero for some days inside the window, for every package at once. When every selected package is at zero on a day, and the selection normally moves at least 100 downloads a day, that day is treated as an npm gap. It is left out of the averages and the change figures, and shows as a break in the line charts. The page lists those dates. A selection of very small packages keeps its zeros as real quiet days.
- **Figures.** Total is the sum over reported days. Per day is the total divided by the reported days. Change is per-day downloads in the latest half of the window against the half before it. Weekend vs weekday is downloads per day on Saturday and Sunday as a percentage of downloads per day on weekdays, by UTC date. Share is a package's part of the selection's total. The functions are pure and tested in `src/lib/analytics.ts`.
- **Release history.** The browser asks the function `GET /api/releases?name=` (`netlify/functions/releases.ts`), which streams the registry record from `registry.npmjs.org` and keeps only its `time` object (`netlify/shared/timeExtractor.ts`). The records of busy packages are tens of megabytes (prisma 44 MB, drizzle-orm 65 MB, vite 39 MB), too much for a phone to download and hold. The function validates the name, reads from the one fixed host, stops at 250 MB and times out at 22 seconds; a record over the cap is reported as exactly that. In `npm run dev` the function is not served, so release history needs `netlify dev`.
- **Charts.** Daily downloads with a marker on every unusual day (the hero), a 7-day moving average that removes the weekly cycle, and a share bar. They are drawn as SVG on the family chart frame. A log-scale switch keeps a small package visible beside a large one; it cannot draw zero, so a zero day shows as a gap.
- **Spikes.** Downloads move by ratio, so each day is judged on its natural log against the same weekday in the weeks before it: the median of up to 8 earlier same-weekday values. The robust score is `(ln(day) - median) / (1.4826 * MAD)`, with the scale never below 8 percent so a very steady package is not flagged for a small wobble. A day is a spike at a score of 3.5 or more, and needs at least 4 earlier same-weekday values. Only upward days are reported: the large downward days are holidays and outages, which no release explains. Each package keeps its eight strongest spikes in the window for the list; the page shows how many were found and how many are listed, and the model is told the list is capped. A count of unusual days an explanation states is checked against the number found or the number listed. Unreported and zero days are not judged and not used in a baseline. The code and its tests are in `src/lib/spikes.ts` and `tests/unit/spikes.test.ts`.
- **Releases.** The registry record `https://registry.npmjs.org/{package}` has a `time` map: version to publish date. The page gets it through the release service (below). Only stable versions (x.y.z) count; prereleases and canary builds are left out. A release matches a spike when it was published on the spike's UTC day or up to three days before it. Each is called major, minor or patch from its number (from 1.0.0: a new first number is major, a new second number minor, anything else patch; below 1.0.0 the second number is the big step). The registry says nothing about what a release changed, so this reads the number only. If the registry cannot be read for a package, its spikes are listed as "release history unavailable", never as "no release nearby".
- **States.** Loading, a package that is not on npm (with a Remove button), npm rate limiting, a network failure or timeout (10 seconds per request), a reply that is not the documented shape, and a partial failure where the other packages are shown with a note and a Retry button.

Explain spikes sends only the computed figures for each package and the list of unusual days with their matched releases, not the daily numbers, to a server function. The function calls the model through OpenRouter and streams the answer back as it is written. On a desktop, the controls stay in a compact rail on the left, with the Explain spikes button docked at the bottom of it, while the chart, the explanation and the trace scroll on the right. On a phone, the same parts stack.

## Agentic steps

The run trace lists these steps in order. Before a run, each row says what its step does. While a run is going, the step in progress is marked. The server times each step.

| Step | What it does | What the UI shows |
| --- | --- | --- |
| Build request | Builds the prompt from the summary figures that the request check has already accepted | Package count and the dates |
| Call model | Sends one chat request with the fixed model, a 4,096-token output cap, reasoning off and usage reporting on. The request has a 10-second limit and one automatic retry after a timeout or a connection failure when the run's budget allows | Provider status and HTTP code, and "Retried once" when it was retried |
| Stream answer | Forwards each text piece to the browser as it arrives | Chunk count, characters and tokens |
| Check figures | The model writes its explanation, then a marker line and a JSON array of claims: for each figure, a quote copied from the explanation, what the figure is (total, per day, change, share, weekend, multiple, difference, a spike's count, usual level or percentage, a count of unusual days, date, version) and the packages it is about. The server finds each quote in the explanation, reads the figure from the quote, and compares it with the one value the claim names, at the figure's own decimals. One resolver (`netlify/shared/attribution.ts`) says which package a written figure is about, for claimed and unclaimed figures alike: the package named in its clause (the nearest one before it, or one tied to it by "for" or "from"), else the one package the nearest earlier clause of the same paragraph names (a leading It or This, a list item under its heading, text after a colon). With no such package a figure may match only values that belong to no one package (the selection's total, a multiple with its pair); anything else is unchecked. A value is read as a figure's only if the figure's words give the same metric ("per day", "in total", "usual", "share", "weekend"); words that give none must fit values of one metric only. A figure no claim covers goes through the same sentence check, which can match it but never rejects it: what it cannot match shows as unchecked. If the claims cannot be read, every figure goes through that check. | How many figures match, the ones that do not (underlined where they are written), and how many are unchecked |
| Validate output | Fails an answer the provider cut off before it finished, or an empty answer. Flags an answer cut at the output cap | Failure message, or cut-off warning |

Run totals sit under the explanation and show time (a clock that ticks while the run goes, then the server-measured total), tokens (with prompt and completion in the hint), cost in USD and the served model. These come from the provider's response. A value the provider did not report reads "not reported".

The status line reads "Explanation complete" when a run finishes. It adds "with a failed check" when a step failed, for example a figure that is not in the summary. A failed check does not mean the run failed.

## Architecture

Browser (React, Vite) to `POST /api/ai` (Netlify Function, `netlify/functions/ai.ts`) to OpenRouter chat completions.

- **Keys.** `OPENROUTER_API_KEY` is read only by the function. It is never sent to the browser, logged, or written into a response.
- **Model.** One server constant, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), in `netlify/shared/provider.ts`. The browser cannot choose a model, and a model field in the request is ignored. There is no model picker. The model is pinned to Haiku 5.5, which rejects `temperature`, so the request never sends one.
- **Validation.** The function checks the origin allowlist (403), the method (405), a rate limit of 20 requests per minute per client (429), the body size of 32,000 bytes (400), the provider key (500 when `OPENROUTER_API_KEY` is not set), JSON (400), and the summary (400, naming the field): one to five packages, each name a valid npm name and not repeated, real dates that match the window length, and every figure a finite number inside its range. If Content-Length is missing, the whole body is read before the size check. That relies on Netlify's 6 MB limit on buffered request payloads.
- **Timeouts.** One 25-second deadline covers the provider call and the stream after it. When the deadline ends a stream, the provider body is cancelled, so a stream that never closes cannot hold the run. The browser also gives up after 30 seconds with no byte from the stream, or after 60 seconds in all, with a plain message and a Try again button. Stop is silent.
- **Errors.** Provider 401 and 403, 402, 429, 5xx and errors inside the stream map to plain sentences. The browser shows only those sentences. Provider response bodies are never sent to the browser or logged. A stream that ends without `[DONE]` or a finish reason fails the run with a cut-off message.
- **Retries.** The model request gets one automatic retry after a 10-second timeout or a connection failure, when at least 8 seconds of the run's budget remain. It is never retried after an HTTP error status (401, 402, 429, 5xx), after the viewer leaves, or once the answer has started. The trace says "Retried once" when it happened. Explain again starts a new run.
- **Stop.** Stop aborts the browser request, which closes the stream.

Shared modules in `netlify/shared/`: `contract.ts` (the summary type and the npm package-name rule, imported by the browser as well so the two sides cannot drift), `insights.ts` (prompt, figure check, request validation), `stream.ts` (reading the provider stream and writing browser frames), and `provider.ts` (model constant, endpoint, request body).

Spike evidence, its validation and its part of the answer check live in `netlify/shared/evidence.ts`.

Browser modules in `src/lib/`: `spikes.ts` (detector, release matching, evidence), `releases.ts` (registry read, version classification), `chartGeometry.ts` (scales, ticks, line paths, label spacing), `npm.ts` (URL, reply parser, fetching with timeouts and error kinds), `analytics.ts` (window, gaps, totals, change, weekend pattern, moving average), `dates.ts`, `format.ts`, `api.ts` (the insights stream) and `insightRun.ts` (run state tied to the summary it was started for, so changing the selection clears a stale answer).

## Run locally

1. `npm ci`
2. `npm run dev` runs the UI only. The dashboard and its charts work, because the browser reads npm directly. The dev server forwards `/api` to port 8888, where only `netlify dev` listens, so Explain spikes reports that the service could not be reached.
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
- The spike detector is a statistical rule, not a judgement: a day is flagged because it is high for its weekday, and many flagged days have no release near them (CI runs, mirrors and busy launch weeks also move the counts). A release just before a spike is a coincidence in time. The data cannot show that it caused the spike, and the prompt tells the model so. Downward days are not flagged.
- Packages are named by their full name, the name after the scope ("the SDK"), or a word of four letters or more that no other selected package shares. A name two packages share names neither. A package called `next` is named as "Next", "Next.js" or in a list, not in "the next month". A long run-together name (modelcontextprotocol) is also read as spaced words.
- Counts of unusual days are checked in one shape only: a number directly before "unusual days", "spikes" or "spike days" (with "with a release" or "no release" right after it), in a clause that names exactly one package or says "in total". It is compared with the number the detector found, not the capped list. "N of the M", "the remaining N", counts of packages, "respectively" lists and counts with no clear owner are shown as unchecked and never rejected. A hedged count written with one significant figure ("nearly 100,000") is unchecked too.
- The figure check tests percentages, download counts, multiples between packages, dates and versions. A version is checked only when written in full as x.y.z. The claims are written by the same model as the explanation, so a figure the model leaves out of its claims is only read by sentence and may show as unchecked. The model is trusted for what a figure is about, never for its value: the value comes from the quote. A figure matches only when a summary value, rounded to the figure's own decimals, equals it. A count written out in full must be exact, unless an approximating word (about, roughly, around, approximately, nearly, almost, some, close to, just over or under, ~) stands within two words before it: then it may be the true value rounded to the significant figures it is written with ("roughly 99,000" matches 99,060; "roughly 120,000" does not).
- Direction is read from a minus or plus sign attached to a figure, or from a fixed list of rise and fall words among the four words before it in the same sentence. Other phrasing, such as "off 13.5%", is not checked for direction. A level such as a share or the weekend ratio is never checked for direction.
- A claim that uses no new number passes the figure check, because the check does not judge conclusions.
- Stop aborts the browser request. The function cancels its provider call only when the platform reports the closed stream, so the provider call may run to completion.
- The rate limit is kept in memory for each function instance. It is a cost guard, not a hard quota.
- Requests with no Origin header are accepted, subject to the rate limit. These are non-browser callers.
- A retried model request leaves less of the 25-second budget for the answer, so a slow second attempt can still end in the timeout message.
- Netlify's synchronous execution limit for functions is 60 seconds, and a site cannot change it. The app's 25-second deadline sits under that limit, so a slow provider gets the timeout message before the platform stops the function.
- The model's answer is not checked for accuracy. The output checks test only whether the answer is empty, cut off, or contains figures that are not in the summary.
