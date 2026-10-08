# ContentForge

Live: https://jdgafx-app-07-content-pipeline.netlify.app

ContentForge turns a topic and a content type (blog post, technical article, marketing copy, newsletter or social thread) into a finished piece of writing. It runs five steps in order. Each step is one call to one fixed model, and the page shows what each call produced, how long it took, what it cost and which model served it.

**What this showcases:** a resumable five-stage pipeline where each stage is one bounded model call with its own trace, tokens and cost.

## Pipeline steps

The trace names below are the names the Run trace shows.

| Step (trace name) | What it does | Word budget |
| --- | --- | --- |
| Research | Dense notes: key facts, figures and background | about 80 |
| Outline | Section headings with a few bullets under each | about 100 |
| Draft | The full piece, built from the research and outline | about 160 |
| Edit | Grammar, flow and argument, at roughly the draft's length | about 160 |
| Polish | A final pass on the edited piece, not longer than it | about 160 |

The page has five sections. The Brief sits beside the others on wide screens and above them on narrow ones.

- **Brief**: topic (it starts with a sample), content type, Generate, Stop, Retry and Resume. A stopped run resumes where it stopped.
- **Pipeline**: the five steps as a chain. Each step shows its state (waiting, running, done, failed or skipped), its word count and what it starts from. A highlighted edge means the step finished and passed its output on.
- **Stage outputs**: each step's output with its word count and a copy button, plus Copy final piece.
- **Run totals**: totals for the run. A figure no call reported shows as "not reported", never as zero.
- **Run trace**: one numbered line per call. Each line shows status, latency, tokens, cost and the served model. A retry is labelled "(retry)". A step that did not run is marked skipped, and the call in progress shows as running.

Retry and Resume reuse finished steps when the topic and content type are unchanged.

## Architecture

The browser (React and Vite) sends one `POST /api/ai` request per step. The Netlify Function in `netlify/functions/ai.ts` builds the prompt, calls OpenRouter, checks the reply and returns the text with its trace, usage and served model.

- **Keys.** `OPENROUTER_API_KEY` is read only by the function. It is never sent to the browser, logged, or shown in an error.
- **Model.** One server constant, `~anthropic/claude-haiku-latest`, in `netlify/shared/provider.ts`. The browser cannot choose a model, and no environment variable overrides it. The page shows the model the provider reports for each call.
- **Requests.** Every request is checked: JSON shape, field types, a 400-character topic limit, the content type list, the stage name, stage order, and an 8,000-character limit on each earlier output. The body is limited to 128 KB, both by declared length and by measured size.
- **Origin and rate.** Only the site and local dev origins are accepted. Each client may send 30 stage requests a minute, which is about six full runs. The count is kept per warm function instance.
- **Provider call.** Each call has an 8-second timeout, a 4,096-token ceiling and `usage: { include: true }`, so OpenRouter reports tokens and cost.
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

The tests never reach OpenRouter. `vitest.config.ts` blanks every provider key. Each smoke test stubs `fetch`, and a call that is not stubbed fails the test.

## Layout

- `src/` is the page: `App.tsx`, the components, and `lib/api.ts` (browser client and stage sequencing) and `lib/run.ts` (trace, totals, stage states and resume rules).
- `src/components/` holds the Pipeline, Brief, Stages (stage outputs), RunSummary (run totals) and RunTrace components. `StateMark.tsx` draws each state as a dot and a word.
- The page loads Atkinson Hyperlegible Next and JetBrains Mono from Google Fonts. Without them it falls back to system fonts.
- `netlify/functions/ai.ts` is the only function. It validates the request, runs one stage and maps failures.
- `netlify/shared/` holds the access checks, the provider call and the stage prompts and output rules.
- `tests/unit/` covers the stage rules, the provider mapping, the run logic and the client pipeline. `tests/server/` covers the function.

## Known limits

- Stop aborts the browser request. The server call still completes, and the provider still bills it.
- The page does not stream. Each step returns one reply when it finishes.
- The label check recognises the label formats seen so far and any content-safety model name. It is not a content judge, and no output is fact-checked.
- The rate limit is per warm function instance, so it is a cost guard, not a hard quota.
- A step that is retried makes two model calls, each with its own 8-second limit.
- Cost appears only when OpenRouter reports it. Otherwise the page shows "not reported".
- Runs are not saved. Closing the page loses the outputs.
- The layout was checked by reading the CSS and by the build. It was not viewed in a browser or on a device.
