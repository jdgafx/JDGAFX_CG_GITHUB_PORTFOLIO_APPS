# AgentFlow: multi-agent research orchestrator

AgentFlow answers one research question from live public sources. A Retrieve step first looks the question up on the live web (Tavily search), on arXiv, on Hacker News and, as background, on Wikipedia; one model call then keeps only the results that are about the question. Then four model calls run in a fixed order. A Researcher lists key facts from those sources with [n] citations, an Analyst finds patterns in them, a Critic names gaps, and a Synthesizer writes the final report from those three outputs. The report keeps the citations and ends with a Sources list of links. A fifth step, the Audit, then checks every sentence of that report that carries a [n] marker against the text of the source it cites, and marks each one supported, partly supported or not supported. The page draws the six steps as a graph, shows a trace with the time of each step and the tokens and cost of each model stage, and shows the model the provider served. The report can be exported as PDF, Word or Markdown, and each file includes the sources.

What this showcases: a fixed multi-agent pipeline grounded in fresh public data (web pages, papers, discussions), and a citation audit that checks each cited claim in the final report against its source and shows the sentence of the source that backs it, or that nothing does.

Each stage's output appears when that stage has finished. The server reads each model reply as it arrives, but it sends a stage to the browser only when that stage ends.

## The pipeline

The step names below are the ones the Run trace shows.

| Step | What it does | Output cap | Time cap |
| --- | --- | --- | --- |
| Retrieve | Searches the web, arXiv, Hacker News and Wikipedia for the question, in parallel, and then one model call keeps only the results that are about the question, and numbers them (at most 8 sources) | one relevance call (3,000 tokens) | 4 s per site, then 6 s |
| Researcher | Lists three to five key facts, each cited as [n] to a retrieved source | 2,200 tokens | 8.5 s |
| Analyst | Finds two or three patterns in the research and keeps the citations | 2,200 tokens | 8.5 s |
| Critic | Names two or three gaps, including claims with no citation or one source | 2,000 tokens | 7.5 s |
| Synthesizer | Writes the final report from the three outputs. It follows a length or format the question sets, and otherwise aims for 200 to 300 words | 2,800 tokens | 13 s |
| Audit | Separate request after the report: checks each cited sentence against its source (see Citation audit) | 4,500 tokens | 20 s per attempt, 26 s budget |

Thinking is on, so each token ceiling holds the model's thinking as well as its answer, and the answers are still kept short by their prompts. The time cap is a ceiling for one attempt. The run budget in the next section can shorten it.

### Citation audit

The Audit runs after the Synthesizer, as its own request to `/api/audit` with its own 26 second budget, so it never shortens the research run. The page sends the finished report and the sources it holds, shows "Auditing" while the request is out, and fills in the verdicts when it answers.

1. **Claims.** Every sentence of the report body (the Sources section is left out) that carries a [n] marker is one claim. Sentences are cut at full stops, with a marker after the stop kept with its sentence, and not at abbreviations or decimals. The server and the page run the same code, so they agree on the claim numbers without sending claims back and forth. At most 20 claims are checked; any further ones are listed as not checked and the page says how many.
2. **Pre-pass (no model).** For each claim the code counts the share of its content words found in the text of the sources it cites (the title, the extract and the counts line), and checks that every number in the claim appears in that text (1,200 and 1200 are the same) and that every capitalised name does (a name counts as found when any of its words is there, and months are ignored). A claim that cites a source that is not in the list, or shares no content word with the source it cites, is decided here as not supported, without the model.
3. **Judgment (one Haiku 5.5 call).** The remaining claims go in one call with the numbered extracts. For each claim the model returns supported, partly supported or not supported, the number of the source, one sentence copied from that source, and a reason of at most fifteen words.
4. **Checks the model cannot waive.** The quote is searched for word for word in the cited source (ignoring case, spacing, curly quotes and a trailing ellipsis; at least three words). A quote that is not there is dropped and the claim cannot be "supported": it becomes "partly supported" with the note that the quote was not found. A supported claim whose number or name is in none of the cited sources is also capped at "partly supported", with the missing item named. A claim the model gave no verdict for is "not checked". Nothing is removed from the report.
5. **On the page.** Each cited sentence in the report carries its badge (a shape and a word: check, half circle, cross, dash) and is underlined in its verdict's style, with a thin line for supported and thick, dashed or wavy lines for the rest, so the exceptions stand out. The headline reads "14 of 16 cited claims supported", under it a bar of the four verdicts and a legend with the counts. Selecting a claim opens the source panel: the claim, the reason, each cited extract with the verified quote marked, and the pre-pass in words. On a phone the panel is below the report and the page scrolls to it.

The audit uses the same model constant as the stages, sends no temperature and leaves thinking on (no reasoning override is sent). A hung model call is tried once more when the budget allows and the result says so. The browser ends the audit after 45 seconds, body read included, and shows the failure with a "Try the audit again" button; the sentences stay listed as not checked with their pre-pass. Stop during an audit ends it and says so.

### Retrieval

Four sites are asked in parallel. Up to 8 sources are kept: web 3, arXiv 2, Hacker News 2, Wikipedia 1.

- **Web (Tavily):** one `POST` to `api.tavily.com/search` with the raw question (the search call only, basic depth, no page extraction). Each result is a page title, link and the extract Tavily returned, cut to 500 characters. The link is the one Tavily returned, kept only when it is `https` with no login in it, and with brackets and parentheses escaped so it survives markdown. It is never built from a title. The key is `TAVILY_API_KEY`, read only on the server; without it the trace says "Web search is not set up on this server" and the other sites carry on.
- **arXiv:** one request to `export.arxiv.org/api/query` for papers that carry any of the topic words, best match first. arXiv answers XML, read by a short parser. The link is built from the paper id (`https://arxiv.org/abs/<id>`, without the version number, so it always opens the latest). The source text is the abstract, cut to 500 characters.
- **Hacker News:** one request to `hn.algolia.com/api/v1/search` returns stories with more than 20 points. Its source text is the title, points, comments and month, which are the facts the API gives. The link is the discussion page, built from the numeric id.
- **Wikipedia (background):** two requests to `en.wikipedia.org/w/api.php` (`generator=search`, `prop=extracts`, `exintro`, `explaintext`): one for pages that carry all the topic words and one for pages that carry any of them (a long question has no page with every word). The intro is cut to 500 characters; two candidates go to the relevance call and the first relevant one is kept.
- **One relevance call for every site:** after the four lookups, one model call (the same Haiku model and OpenRouter client as the stages) is given the question and every candidate (about 14: web 5, arXiv 4, Hacker News 3, Wikipedia 2) with its site, title, a 300 character excerpt and its date, and answers JSON only: `{"results":[{"n":1,"relevant":true}, ...]}`. Code reads only `n` and `relevant`, drops an out-of-range or repeated number, and keeps the relevant results up to the caps above. Code does not judge relevance itself: there are no word lists, no overlap rules and no score cut-offs, so a nonsense question finds no source on any site and shows no unrelated one. The call has its own 6 second deadline inside the run budget (it takes about 3 s). If it fails, times out or answers something unreadable, the web search's own ranking stands for the web (top 3) and the other sites are dropped, and the trace says "The relevance check ... so web results are in the search's own order and the other sites were left out." Its tokens and cost are on the Retrieve step of the trace and in the run totals. If it keeps nothing, the run stops with "No sources found" before any stage runs.
- **Page text:** markdown images and "Image 9: ..." caption lines are taken out of a web result before the 500 character cut.
- **Search words:** the question is cut down to its topic words (question openers and filler are dropped, at most eight kept) for arXiv, Hacker News and Wikipedia. Tavily gets the question as typed.
- **Numbering and links:** sources are numbered 1 to n, web first, then arXiv, Hacker News and Wikipedia. Every link is https.
- **Limits:** each lookup has its own 4 second deadline (body read included) and the relevance call its own 6 seconds, and a reply over 200 KB is refused. A dropped connection is tried once more. Retrieval draws on the same 27 second run budget as the model stages, so a slow lookup or relevance call shortens the stages instead of adding to the run. All eight sources of a full set reach the Researcher in one block of at most 4,400 characters.
- **Honest failure:** if a site fails, hits a limit or finds nothing, the trace says which and why (a Tavily 429 reads "Web search over its monthly limit"). The others carry on. If no source is found at all, the run stops before any model call: the page shows "Live data unavailable", Retrieve is Failed, and no report is written, because a report from model memory would be substitute data. No source is ever made up.
- **Prompt safety:** source text is passed as quoted data and the Researcher is told it is not instructions. The model never writes the Sources list: the server appends it from the retrieved list, so the links cannot be invented.
- **Free tier:** the web search uses the Tavily free tier (1,000 searches a month), shared with the research agent in app-11. One question is one search.

## What the page shows

The page follows the portfolio's design system (instrument-bench masthead with the app plate "01", a control rail on the left, the run on the right). Once a run has ended the report comes first, then the figures, the graph and the trace; before a run the graph leads.

- **Controls:** the research topic with a character count (no silent cutting: a question over 500 characters cannot be started and says by how much), Start research and Stop in a dock that stays in view, the examples, and the export group. Stop ends the run, or the audit when only the audit is going. Export offers PDF, DOCX or Markdown once a run has output, and each file holds all four stages and the sources.
- **Final report:** the Synthesizer's report (headings in sentence case) with the audit headline, bar and legend above it and a badge on every cited sentence. The source panel opens beside the report (below it on a phone) only when a claim is selected. The numbered source list and, on a phone, the export group follow the report; the source list and the stage outputs are folded on a phone. States: empty, researching, failed (with Try again), stopped (with Start again), and for the audit: auditing, finished, did not finish (with a retry), stopped, and nothing to check.
- **Run figures:** time, tokens, cost in USD and the served model, for the run and, once it has finished, the audit. A figure the provider did not send shows as "not reported". The page never estimates one.
- **Pipeline:** one box per step, six in all: Retrieve, Researcher, Analyst, Critic, Synthesizer and Audit, each with its word (Waiting, Working, Finished, No sources, Cut off, Failed, Not run, Stopped, Auditing) and its time. The hand-offs are labelled Sources, Research, Analysis, Gaps and Report, and a taken hand-off takes the signal colour. The steps snake three to a row, and stand in one column on a narrow stage.
- **Run trace:** one numbered line per step with its status, a one-line summary, its time, a bar on a shared time axis, and for finished model stages their tokens and cost. A stage that was tried a second time says "Retried once after a timeout" (or a dropped connection, a provider error, an empty or cut-off reply).
- **Stage outputs:** one tab per step before the report (Retrieve, Researcher, Analyst, Critic), each filled when its step finishes. Retrieve lists the sources with the extract the Researcher saw.

## Architecture

```
Browser (React, Vite, SVG graph)
  -> POST /api/ai        body: { "query": "..." }
       Netlify Function (netlify/functions/ai.ts)
         -> Tavily web search, arXiv, Hacker News and Wikipedia, in parallel (Retrieve)
         -> OpenRouter chat completions, one request per stage
         <- each model reply, read as it arrives
  <- server-sent events: retrieve_start, retrieve_complete, agent_start,
     agent_chunk, agent_complete, agent_skipped, agent_error,
     session_complete, then [DONE]
```

```
Browser, when the report is done
  -> POST /api/audit     body: { "report": "...", "sources": [...] }
       Netlify Function (netlify/functions/audit.ts)
         -> pre-pass (src/lib/audit.ts), then one OpenRouter call for the claims it cannot decide
  <- one JSON body: claims with verdicts and verified quotes, summary, usage, model, time
```

- **Keys:** `OPENROUTER_API_KEY` is read only on the server, in `netlify/shared/provider.ts`, and `TAVILY_API_KEY` only in `netlify/shared/retrieve.ts`. The browser never receives either.
- **Model:** one server constant, the OpenRouter alias `~anthropic/claude-haiku-latest`, which resolves to the newest Claude Haiku. The page and its figures show the model OpenRouter answered with, not the alias. The page has no model picker, and a model field sent by a client is ignored.
- **Every provider call:** sends an explicit `max_tokens` and asks for usage, including cost. No reasoning override is sent, so the model keeps its default thinking; thinking tokens count against `max_tokens`, so each ceiling is sized to hold both.
- **Where the logic lives:** retrieval (URLs, parsing, caps, timeouts) is in `netlify/shared/retrieve.ts`. The four stage prompts and caps are in `netlify/shared/agents.ts`. Reading the provider reply and retrying are in `netlify/shared/stream.ts`. Request checks are in `netlify/shared/gate.ts`.

### Request checks

- Only POST runs a research. Other methods get a 405. The browser's OPTIONS preflight gets a 204 for an allowed origin.
- A browser request from an origin that is not the site's own host and not listed in `ALLOWED_ORIGINS` gets a 403. Requests with no Origin header are not blocked by this check.
- The audit endpoint answers POST only, with the same origin and per-address rate checks (its own counter). Its body is JSON of at most 40 KB: a report of at most 8,000 characters and up to 8 sources numbered from 1, each with a title and at most 500 characters of text. Anything else gets a 400.
- The body must be JSON of at most 8 KB. `query` must be text of 1 to 500 characters after trimming. Anything else gets a 400.
- Each client address gets 10 requests a minute, and the eleventh gets a 429. The count is kept in memory, so the limit is best effort: each warm function instance keeps its own count.
- Every error is JSON with one plain-language `error` field. An unexpected failure returns a generic 500 message and no detail.

### Time limits and retries

- One run has a 27 second budget shared by Retrieve and all four stages. That budget is the real bound on a run, kept 3 seconds inside the 30 second cut-off that the app treats as the platform limit, so the budget always ends a run first.
- Each attempt is capped at the stage's own time cap and at what is left of the run budget. A stage does not start with less than 2 seconds left, and it is then marked Not run.
- A stage gets at most one retry. The retry happens when the reply was empty or cut off, when the provider returned 429 or a 5xx with no text, when the call hung until its time cap before any answer, or when the connection failed outright. A rejected request (4xx other than 429) and a stop by the visitor are never retried. A hung call is retried at once, a failed one after 0.8 s, and only when 2 seconds of the budget remain. The result carries why it was retried and the trace shows it. Once headers arrive, a body that is cut off is retried if the budget allows, and any text that already arrived is kept. A retry does not start with less than 2 seconds of budget left. If the retry delay leaves too little budget, the provider's own 429 or 5xx is reported, not a timeout.
- Usage from both attempts is added together when both report it, because a retry is billed too. If an attempt reports no usage, the stage shows its figures as not reported.
- In the browser, the server has 15 seconds to answer, the stream may stay silent for at most 30 seconds between reads, and the whole run is ended after 60 seconds (the 27 second budget plus a wide margin), each with a plain message. The audit request is ended after 45 seconds, body read included. Stop stays silent.

### Messages a visitor can see

| Situation | Message |
| --- | --- |
| Provider returns 401, 402 or 403 | The AI provider rejected the key or is out of credit. |
| Provider returns 429 | Rate limited, try again in a minute. |
| Provider returns 5xx or 408, or times out | The AI provider did not answer in time. |
| A stage returns no text after its retry, and its last attempt timed out | The AI provider did not answer in time. |
| A stage returns no text after its retry, for another reason | {Stage} returned no text. Try again. |
| A stage fails for another reason | {Stage} could not finish. Try again. |
| The web search, arXiv, Hacker News or Wikipedia fails, hits a limit or finds nothing | Not an error. The trace line and the Retrieve tab say what happened, and the run goes on without those sources. |
| The browser cannot reach the server | Could not reach the server. Check your connection and try again. |

Raw provider bodies, stack traces and key material are never shown.

## Run it locally

Environment variable names. Set the values in your own shell or in the Netlify site settings:

- `OPENROUTER_API_KEY`: required for real runs. Server only.
- `TAVILY_API_KEY`: the web search. Server only. Without it the other three sites still answer and the trace says the web search is not set up.
- `OPENROUTER_URL`: optional. Defaults to OpenRouter's chat completions endpoint.
- `ALLOWED_ORIGINS`: optional. Extra browser origins, comma separated, allowed to call the function.

```bash
npm ci
npm run dev        # UI only. Vite proxies /api to localhost:8888, so research runs fail here.
npx netlify dev    # UI and functions together on localhost:8888. Needs the Netlify CLI.
```

Checks. These call no real provider or public API, except `npm run test:live`:

```bash
npm test           # unit tests and function smoke tests. The provider and the four public sources are mocked with fetch stubs.
npm run lint
npm run typecheck
npm run build
bash tests/live/run-live.sh   # live: asks the real web search, arXiv, Hacker News, Wikipedia and the relevance model (keys from the Netlify site). Not part of npm test.
```

Tests live in `tests/unit` (the audit's claim extraction, pre-pass, quote verification, verdict rules and summary; the audit request checks and verdict parsing; the page's audit client; rendering of the badges, summary, panel and report states; retrieval URLs, parsing and degradation with recorded-shape fixtures, source numbering and the Sources section, graph layout and trace rows, stage definitions, request checks, frame parsing, retry and deadline rules, usage math, markdown, export text, and the browser's event parser) and `tests/server` (the research function's full response, read frame by frame, and the audit function end to end with a mocked provider).

## Live site

https://jdgafx-app-01-multi-agent-orchestrator.netlify.app

The masthead shows a "Live data: Web + arXiv + Hacker News + Wikipedia" chip, naming the sites that really answered. It lights up, with the fetch time, only when the retrieval step returned sources, and reads "Live data unavailable" when it failed or found nothing. Nothing canned is reachable: a failed lookup is an error, never substitute data.

## Known limits

- Output arrives one stage at a time, when that stage ends. It does not arrive token by token.
- Stop ends the browser's request. The server then cancels the run: the model call in flight is aborted and no later stage starts. Tokens already generated may still be billed.
- The rate limit is per warm function instance. It resets when an instance restarts.
- Token counts and cost come from the provider's usage report. When the provider sends no figure, the page says "not reported".
- The served model is the one OpenRouter reports in its reply. The request names the Haiku alias, so the served model is whichever Haiku the alias resolves to; the page shows what OpenRouter reports, never the alias.
- The audit checks citations, not truth. It judges each claim against the extract of the source it cites (at most 500 characters of a web page extract, an arXiv abstract or a Wikipedia intro, or the title and counts of a Hacker News story), so a claim the article supports further down shows as partly or not supported, and the panel says when an extract is cut. The verdicts come from one model and its quotes are verified word for word, but the verdicts themselves have no labelled evaluation set yet. The audit relies on the model to spot reversed order or direction ("after" where the source says "until"). The code lowers or caps a verdict only on what it can match exactly: a quote that is not in the source, a number or name the source lacks, a ranking word the source does not use, and a reason in which the model itself admits a gap or a contradiction.
- The audit trusts the sources the page sends with the report. It does not fetch them again, so a caller who edits that request can audit against text of their choosing. That affects only the caller's own audit.
- A sentence about the research itself (for example "this rests on a single source") is recognised by its wording and not audited. A sentence the patterns miss is audited like any claim.
- The checks in code only ever lower a verdict, never raise one: a supported verdict is capped to partly when the quote is not found, a number or name is missing from the source, a superlative is not stated, or the model's own reason admits a gap. The cost is under-credit: a hedged claim whose core the source states ("generally described as…") can come back partly or not supported.
- Only cited sentences are audited. An uncited sentence in the report is not judged, and the Synthesizer is told to leave analysis and critique uncited.
- A web source is the extract the search returned, not the whole page, and a Hacker News source carries only the title and counts, not the discussion. One model call decides which results are about the question; it can be wrong, and when it fails the web results are used in the search's own order and the other sites are dropped. A nonsense question finds none and gets no report. How recent the web sources are depends on what the search ranks first; the page shows each source's host or date, and does not promise the newest.
- The web search uses the Tavily free tier (1,000 searches a month, shared with app-11). When it runs out the trace says so and the other three sites carry on. arXiv adds no source to a general question, which is correct.
- Retrieval can take up to 4 seconds of the 27 second budget (typically under 1 second), which leaves the Synthesizer less time.
- On a slow provider the Synthesizer can be cut off or not run inside the 27 second budget. The page marks those stages.
- A stage cut off before its finish reason keeps its text and is labelled cut off in the trace, the graph and the report.
- An error before the stream starts, such as an unreachable server, appears in the alert. No stage is marked failed in that case, because none has started.
- There is no demo recording yet.
- The research text is cut to 1,500 characters when the Analyst and Synthesizer read it, so a long research output can lose its last citation there.
