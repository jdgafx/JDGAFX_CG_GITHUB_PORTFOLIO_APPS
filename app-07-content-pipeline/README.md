# ContentForge

Live: https://jdgafx-app-07-content-pipeline.netlify.app

ContentForge turns a topic and a content type (blog post, technical article, marketing copy, newsletter or social thread) into a finished, cited piece of writing. It first looks the topic up live on Wikipedia and Hacker News, then runs five writing steps in order. Each writing step is one call to one fixed model. The page shows what each step produced, how long it took, what it cost and which model served it.

**What this showcases:** a resumable pipeline that first fetches live Wikipedia and Hacker News sources, then runs five bounded model calls that cite them, each with its own trace, tokens and cost.

## Pipeline steps

The trace names below are the names the Run trace shows.

| Step (trace name) | What it does | Word budget |
| --- | --- | --- |
| Sources | Live lookup, no model: up to three Wikipedia article introductions and up to three Hacker News stories, numbered | none |
| Research | Dense notes drawn from the numbered sources, each fact tagged with its number | about 80 |
| Outline | Section headings with a few bullets under each | about 100 |
| Draft | The full piece, built from the sources, research and outline; cites with [1], [2] | about 160 |
| Edit | Grammar, flow and argument, at roughly the draft's length; keeps the citations | about 160 |
| Polish | A final pass on the edited piece, not longer than it. The function then ends it with a Sources list | about 160 |

The page has five sections. The Brief sits beside the others on wide screens and above them on narrow ones.

- **Brief**: topic (it starts with a sample that Wikipedia and Hacker News both cover), content type, Generate, Stop, Retry and Resume. A stopped run resumes where it stopped.
- **Pipeline**: the six steps as a chain. Each step shows its state (waiting, running, done, failed or skipped), its word count (for Sources, the number of sources found) and what it starts from. A highlighted edge means the step finished and passed its output on.
- **Stage outputs**: each step's output with its word count and a copy button, plus Copy final piece. Sources appear as numbered cards with the source, title link, extract or points and date, and a line for each lookup that failed or found nothing.
- **Run totals**: totals for the run. A figure no call reported shows as "not reported", never as zero.
- **Run trace**: one numbered line per call. Each line shows status, latency, tokens, cost and the served model. A retry is labelled "(retry)". A step that did not run is marked skipped, and the call in progress shows as running.

Retry and Resume reuse finished steps, the Sources step included, when the topic and content type are unchanged.

## Sources step

The step runs in the function, not in the browser, as `stage: "sources"` on `POST /api/ai`. It makes no model call, so its trace row shows no tokens or cost.

- **Wikipedia.** One request to `en.wikipedia.org/w/api.php` (`generator=search` with plain-text introductions) returns the top articles. Stubs and disambiguation pages are skipped, and each extract is cut at a sentence end at about 520 characters.
- **Hacker News.** One request to `hn.algolia.com/api/v1/search` for stories with at least 20 points. A story is kept only if its title shares about half of the topic words, so Hacker News appears only when it discusses the topic. The three highest-scored are kept, with title, points, date and link. Hacker News gives headlines only, so the writing steps are told to cite one only for what its title shows. It is not searched for marketing copy.
- **Limits.** Both requests run in parallel under one 4-second cap (`AbortSignal.timeout`), refuse redirects, and refuse an answer over 256 KB. The hosts are fixed constants, never taken from the topic.
- **Failure.** A lookup that times out, errors or finds nothing adds a plain note, shown in the trace row and the Sources card list. If nothing is found, the writing continues, the prompts forbid specific figures, dates and quotes, and the finished piece ends with a line saying it has no sources and is unchecked. No source is ever invented.
- **Citations.** Draft cites facts as [1], [2]. After Polish, the function removes any marker that points at no real source, removes any source list the model wrote, and appends the Sources list built from the lookup. A social thread gets short links, other types get linked titles with the site, points and date.
- **Untrusted text.** Wikipedia and Hacker News text goes into the prompt as reference material, and the prompt says never to follow instructions inside it.

## Architecture

The browser (React and Vite) sends one `POST /api/ai` request per step. The Netlify Function in `netlify/functions/ai.ts` runs the source lookup, or builds the prompt, calls OpenRouter, checks the reply and returns the text with its trace, usage and served model.

- **Keys.** `OPENROUTER_API_KEY` is read only by the function. It is never sent to the browser, logged, or shown in an error.
- **Model.** One server constant, `~anthropic/claude-haiku-latest`, in `netlify/shared/provider.ts`. The browser cannot choose a model, and no environment variable overrides it. The page shows the model the provider reports for each call.
- **Requests.** Every request is checked: JSON shape, field types, a 400-character topic limit, the content type list, the stage name, stage order (a writing step needs the Sources output first), and an 8,000-character limit on each earlier output. The body is limited to 128 KB, both by declared length and by measured size.
- **Origin and rate.** Only the site and local dev origins are accepted. Each client may send 30 stage requests a minute, which is five full runs of six requests. The count is kept per warm function instance.
- **Provider call.** Each model call has an 8-second timeout, a 4,096-token ceiling and `usage: { include: true }`, so OpenRouter reports tokens and cost.
- **Output checks.** A reply is refused when it is a safety label such as "User Safety: safe", when a content-safety model served it, when it is empty, when it was cut off at the token limit, or when it has fewer than five words. Edit must keep at least half the words of the draft, and Polish at least half the words of the edit.
- **Errors.** The function returns plain messages only. The provider's error body is never copied out. Examples: "The AI provider rejected the key or is out of credit.", "Rate limited, try again in a minute.", and "The AI provider did not answer in time." The page shows each error in a red alert and marks the failed step in the trace.
- **Retries.** A step is retried once, and only when its reply was empty, cut off, or far shorter than the text it was given. Timeouts, provider errors, network failures and refused replies are not retried automatically. Retry is the user's own button.

## Run locally

Requirements: Node.js and npm.

```sh
npm ci
npm run dev              # page only: Generate cannot reach /api/ai, so runs fail with a message
npx netlify dev          # page and functions together
```

For `npx netlify dev`, set `OPENROUTER_API_KEY` in the local Netlify environment. Do not commit it. Netlify sets `URL`, `DEPLOY_PRIME_URL` and `DEPLOY_URL` itself, and the origin check reads them.

Checks:

```sh
npm test                 # unit tests and function smoke tests
npm run lint
npm run typecheck
npm run build
```

The tests never reach OpenRouter, Wikipedia or Hacker News. `vitest.config.ts` blanks the provider key. Each smoke test stubs `fetch`, and a call that is not stubbed fails the test. The Wikipedia and Hacker News parsers are tested against responses recorded in the test files; the app itself always fetches live.

## Layout

- `src/` is the page: `App.tsx`, the components, and `lib/api.ts` (browser client and stage sequencing) and `lib/run.ts` (trace, totals and stage states). The page imports its stage names, content types and types from `netlify/shared/contract.ts`, and reads the Sources output with `netlify/shared/sourcepack.ts`; both are pure files, with no server code.
- `src/components/` holds the Pipeline, Brief, Stages (stage outputs), SourceList (source cards), RunSummary (run totals) and RunTrace components. `StateMark.tsx` draws each state as a dot and a word.
- The page loads Atkinson Hyperlegible Next and JetBrains Mono from Google Fonts. Without them it falls back to system fonts.
- `netlify/functions/ai.ts` is the only function. It validates the request, runs one stage and maps failures.
- `netlify/shared/` holds the shared contract, the access checks, the provider call, the stage prompts and output rules, `sources.ts` (URL building, parsing and the live lookups) and `sourcepack.ts` (the Sources output format and the citation list).
- `tests/unit/` covers the stage rules, the source parsers and format, the provider mapping, the run logic and the client pipeline. `tests/server/` covers the function.

## Known limits

- Stop aborts the browser request. A model call that already started still completes, and the provider still bills it.
- Sources are only as good as the search: a topic written as a long sentence can match weakly on Wikipedia. Noun phrases such as "the James Webb Space Telescope" work best. Hacker News entries are headlines, so they support few claims.
- A cited sentence is not checked against its source. The model can still add a claim the source does not make.
- The page does not stream. Each step returns one reply when it finishes.
- The label check recognises the label formats seen so far and any content-safety model name. It is not a content judge, and no output is fact-checked.
- The rate limit is per warm function instance, so it is a cost guard, not a hard quota.
- A step that is retried makes two model calls, each with its own 8-second limit.
- Cost appears only when OpenRouter reports it. Otherwise the page shows "not reported".
- Runs are not saved. Closing the page loses the outputs.
- The layout was checked in headless Chromium at 1280 and 390 px wide, with no horizontal overflow. It was not viewed on a physical device.
