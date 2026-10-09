# ContentForge

Live: https://jdgafx-app-07-content-pipeline.netlify.app

ContentForge turns a topic and a content type (blog post, technical article, marketing copy, newsletter or social thread) into a finished, cited piece of writing. It first looks the topic up live on Wikipedia and Hacker News, then runs five writing steps in order. Each writing step is one call to one fixed model. The page shows what each step produced, how long it took, what it cost and which model served it.

**What this showcases:** a resumable six-step writing pipeline grounded in live Wikipedia and Hacker News sources, with tracked changes between Draft, Edit and Polish: each change is shown word by word, explained, and checked against the text.

## Pipeline steps

The trace names below are the names the Run trace shows.

| Step (trace name) | What it does | Word budget |
| --- | --- | --- |
| Sources | Live lookup, no model: up to three Wikipedia article introductions and up to three Hacker News stories, numbered | none |
| Research | Dense notes drawn from the numbered sources, each fact tagged with its number | about 80 |
| Outline | Section headings with a few bullets under each | about 100 |
| Draft | The full piece, built from the sources, research and outline; cites with [1], [2] | about 160 |
| Edit | Grammar, flow and argument, at roughly the draft's length; keeps the citations. Also returns 4 to 5 change notes | about 160, plus the notes |
| Polish | A final pass on the edited piece, not longer than it. Also returns change notes. The function then ends it with a Sources list | about 160, plus the notes |

The page leads with the piece. Once a run has ended, the finished piece comes first, then the run totals, the pipeline and the run trace. The Brief sits beside them on wide screens (sticky, with Generate and Stop pinned at its bottom) and above them on narrow ones.

- **Brief**: topic (it starts with a sample that Wikipedia and Hacker News both cover), content type, three examples, Generate, Stop, Retry and Resume. A stopped run resumes where it stopped.
- **The piece**: the Final text with its cited sources, or a Changes view (see below). A failed or stopped run shows the best version written so far, labelled as such, with a Retry or Resume button.
- **Run totals**: time (it ticks while a run is live), tokens, cost and model. A figure no call reported shows as "not reported", never as zero. After a failed or stopped run the figures say "Before it failed" or "Before it stopped".
- **Pipeline**: the six steps as a chain with state, word count (for Sources, the number of sources found) and what each starts from. Each finished step is a button: select it to read its output under the chain (numbered Sources cards, or the model text as headings, lists and paragraphs) and copy it.
- **Run trace**: one numbered line per call with status, latency, tokens, cost and served model, on a waterfall: each bar starts where the call before it ended. A retry is labelled "(retry)". A step that did not run is marked skipped.

## Tracked changes

The Changes view of the piece compares Draft with Edit, and Edit with Polish, word by word, like tracked changes. Added words are underlined on green and removed words are struck through on red, so the two differ without colour; a screen reader hears "Added:" and "Removed:".

- **Diff.** `netlify/shared/diff.ts` is a longest-common-subsequence diff over words. A word is the text between spaces, so `tight,` and `tight` differ. It runs in the browser and on the server, and its tests assert real segments.
- **Counts per step.** Words added, words removed, and sentences rewritten: sentences of the new text that contain at least one added word.
- **Polish and the Sources list.** The function appends the Sources list to Polish. The comparison and the readability figures leave it out.
- **Reasons.** Edit and Polish write the piece, then a `---CHANGES---` line and four or five lines in the form `reason :: words`, in the same call (about 200 more tokens). Four or five are asked for so that two or three survive the check; Polish sometimes keeps only one. The server keeps a reason only if the words it names are found word for word in the new text or in the removed text, and at least a quarter of them (and at least one) were added or removed in the diff. A reason is also dropped when its own claim is false: a removal whose words are still in the new text (or that names words from the new side), "merged" or "combined" when the sentence count did not fall, "split" when it did not rise. The prompt tells the model to describe only what changed. A reason with fewer than three words, with no words named, or naming the same words as another is dropped. At most five are kept. The trace row says how many survived ("3 of 5 change notes kept."). A reply with no notes section keeps its text and shows no reasons.
- **Readability.** `netlify/shared/readability.ts` computes Flesch reading ease and words per sentence for Draft, Edit and Polish. Headings, citation markers and link markup are ignored, and a bullet counts as one sentence. Three versions are too few for a line chart, so each is a figure with its change from the one before.

Retry and Resume reuse finished steps, the Sources step included, when the topic and content type are unchanged.

## Sources step

The step runs in the function, not in the browser, as `stage: "sources"` on `POST /api/ai`. It makes no model call, so its trace row shows no tokens or cost.

- **Wikipedia.** One request to `en.wikipedia.org/w/api.php` (`generator=search` with plain-text introductions) returns the top articles. Stubs and disambiguation pages are skipped, and each extract is cut at a sentence end at about 520 characters. An article is kept only if its title shares a topic word and its opening shares about half of them. A person's page is dropped unless the best search hit is a person too, so "James Webb Space Telescope" does not bring in the man it is named after. Articles whose titles cover more of the topic come first.
- **Hacker News.** One request to `hn.algolia.com/api/v1/search` for stories with at least 20 points. A story is kept only if its title shares about half of the topic words, so Hacker News appears only when it discusses the topic. The three highest-scored are kept, with title, points, date and link. Hacker News gives headlines only, so the writing steps are told to cite one only for what its title shows. It is not searched for marketing copy.
- **Limits.** Both requests run in parallel under one 5-second cap (`withDeadline`, which covers the body read too), refuse redirects, and refuse an answer over 256 KB. The hosts are fixed constants, never taken from the topic.
- **Failure.** A lookup that times out, errors or finds nothing adds a plain note, shown in the trace row and the Sources card list. If nothing is found, the writing continues, the prompts forbid specific figures, dates and quotes, and the finished piece ends with a line saying it has no sources and is unchecked. No source is ever invented.
- **Citations.** Draft cites facts as [1], [2], and the prompts say a [n] may only follow a claim the source text itself states. After Polish, the function removes any marker that points at no real source, and any marker whose sentence shares no word, number or name at all with its source (title, extract and, for Hacker News, its year and link words). The topic's own words count, "painting" matches "repainting", and `C#` or `asm.js` match whole. Emoji and symbols before a marker are skipped when finding its sentence. A marker stays unless there is clearly no connection; the sentence stays either way. Each marker is also compared with the sources outside its own run: a word that several sources contain counts for little and a word only one source contains counts in full, and when another source (Wikipedia or Hacker News) scores at least twice as much and at least one whole word more, a Wikipedia marker moves to it. A marker that points at a Hacker News story never moves, because a headline gives too few words to compare. It also removes any source list the model wrote and appends the Sources list built from the lookup. A social thread gets short links, other types get linked titles with the site, points and date.
- **Untrusted text.** Wikipedia and Hacker News text goes into the prompt as reference material, and the prompt says never to follow instructions inside it.

## Architecture

The browser (React and Vite) sends one `POST /api/ai` request per step. The Netlify Function in `netlify/functions/ai.ts` runs the source lookup, or builds the prompt, calls OpenRouter, checks the reply and returns the text with its trace, usage and served model.

- **Keys.** `OPENROUTER_API_KEY` is read only by the function. It is never sent to the browser, logged, or shown in an error.
- **Model.** One server constant, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned, in `netlify/shared/provider.ts`. The browser cannot choose a model, and no environment variable overrides it. The page shows the model the provider reports for each call.
- **Requests.** Every request is checked: JSON shape, field types, a 400-character topic limit (the page shows a counter and turns Generate off over the limit), the content type list, the stage name, stage order (a writing step needs the Sources output first), and an 8,000-character limit on each earlier output. The body is limited to 128 KB, both by declared length and by measured size.
- **Origin and rate.** Only the site and local dev origins are accepted. Each client may send 30 stage requests a minute, which is five full runs of six requests. The count is kept per warm function instance.
- **Provider call.** Each model call has its own time limit, about 1.5 times the p95 of healthy calls measured live on Haiku 5.5 (Research 6 s, Outline 8 s, Draft 10 s, Edit 7 s and Polish 9 s, which also write their change notes). A call that is still silent then is hung, and waiting longer did not help in measurements, so the function abandons it and tries once more with a fresh limit when the request budget (21 s) covers it. Only a timeout of its own limit or a connection failure is tried again; a provider status (4xx, 429, 5xx), a refused reply and a stop by the user never are. The trace row says "Retried once after a timeout of 10 s." A request therefore stays under about 22 seconds, inside Netlify's cut-off, a token ceiling of five tokens per word of the stage's budget (400 for Research up to 800 for Draft; 1,020 for Edit and Polish, which include room for the change notes) and `usage: { include: true }`, so OpenRouter reports tokens and cost.
- **Browser watchdog.** Each stage request is also ended by the browser after 60 seconds (`AbortSignal.timeout` joined with the Stop signal, covering the body read), with the plain message "The server did not answer in time. Press Retry to run this step again." Stop stays silent.
- **Output checks.** The checks below judge the piece, not the change notes. A reply is refused when it is a safety label such as "User Safety: safe", when a content-safety model served it, when it is empty, when it was cut off at the token limit, or when it has fewer than five words. Edit must keep at least 70% of the words of the draft, and Polish at least 70% of the words of the edit. An Edit or Polish that stops mid-sentence after an input that ended properly is refused. Edit and Polish read the Draft and the Edit whole; only side context (research, outline) is clipped, at a sentence end.
- **Errors.** The function returns plain messages only. The provider's error body is never copied out. Examples: "The AI provider rejected the key or is out of credit.", "Rate limited, try again in a minute.", and "The AI provider did not answer in time." The page shows each error in a red alert and marks the failed step in the trace.
- **Retries.** A step is retried once, and only when its reply was empty, cut off, or far shorter than the text it was given. Provider errors, refused replies and stops are not retried automatically, and a call that times out or cannot connect is retried once inside the same request (see Provider call). Retry is the user's own button.

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

- Headings the model writes in Title Case are shown in sentence case (`lib/titles.ts`), keeping the names found in the topic and the sources (`lib/names.ts`).
- `src/` is the page: `App.tsx`, the components, `lib/api.ts` (browser client, watchdog and stage sequencing), `lib/run.ts` (trace, waterfall lanes, totals and stage states), `lib/compare.ts` (the tracked changes of a step and the readability trend), `lib/blocks.ts` and `lib/markdown.ts` (model text as elements, never as HTML) and `lib/useResultFocus.ts` (on a phone, a finished run scrolls its result into view and focuses its heading). The page imports its stage names, content types and types from `netlify/shared/contract.ts`, and reads the Sources output with `netlify/shared/sourcepack.ts`; both are pure files, with no server code.
- `src/components/` holds the Pipeline, Brief, Stages (stage outputs), SourceList (source cards), RunSummary (run totals) and RunTrace components. `StateMark.tsx` draws each state as a dot and a word.
- The design is the portfolio's shared v3.2 system (`src/styles/tokens.css` and `components.css`, copied unchanged); app-specific rules are in `app.css`. The accent is app 7's moss.
- The page loads Atkinson Hyperlegible Next and JetBrains Mono from Google Fonts. Without them it falls back to system fonts.
- `netlify/functions/ai.ts` is the only function. It validates the request, runs one stage and maps failures.
- `netlify/shared/` holds the shared contract, `diff.ts`, `readability.ts` and `changes.ts` (the change-note format, parsing and checking), the access checks, the provider call, the stage prompts and output rules, `sources.ts` (URL building, parsing and the live lookups) and `sourcepack.ts` (the Sources output format and the citation list).
- `tests/unit/` covers the stage rules, the source parsers and format, the provider mapping, the run logic and the client pipeline. `tests/server/` covers the function.

## Known limits

- Stop aborts the browser request. A model call that already started still completes, and the provider still bills it.
- Sources are only as good as the search: a topic written as a long sentence can match weakly on Wikipedia. Noun phrases such as "the James Webb Space Telescope" work best. Hacker News entries are headlines, so they support few claims.
- The citation check is lexical: it drops a marker only when its sentence shares no word with its source, so it cannot tell that a sentence says more than its source. The model can still embellish after a Hacker News headline.
- The page does not stream. Each step returns one reply when it finishes.
- The change notes are the model's own account, checked only against the text: the check proves the named words changed, not that the stated reason is true. Roughly half of the notes the model writes are dropped (it quotes unchanged text or paraphrases), so a step shows two or three.
- The diff is word by word, so a moved sentence shows as a deletion and an insertion. It is shown as plain text, with headings and bold marks simplified.
- The syllable count behind Flesch is a heuristic, so the scores compare versions of one piece and are not exact grades.
- The Sources list is left out of the comparison, but a citation marker the function removes or moves after Polish appears in the diff as a change by Polish's checks, not by the model.
- The label check recognises the label formats seen so far and any content-safety model name. It is not a content judge, and no output is fact-checked.
- The rate limit is per warm function instance, so it is a cost guard, not a hard quota.
- A step that is retried makes two model calls, each with its own time limit, and a hung call can make a stage request take up to twice its limit.
- Cost appears only when OpenRouter reports it. Otherwise the page shows "not reported".
- Runs are not saved. Closing the page loses the outputs.
- The layout was checked in headless Chromium at 1280 and 390 px wide, with no horizontal overflow. It was not viewed on a physical device.
