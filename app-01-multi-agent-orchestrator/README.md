# AgentFlow: multi-agent research orchestrator

AgentFlow answers one research question from live public sources. A Retrieve step first looks the question up on Wikipedia and Hacker News. Then four model calls run in a fixed order. A Researcher lists key facts from those sources with [n] citations, an Analyst finds patterns in them, a Critic names gaps, and a Synthesizer writes the final report from those three outputs. The report keeps the citations and ends with a Sources list of links. A fifth step, the Audit, then checks every sentence of that report that carries a [n] marker against the text of the source it cites, and marks each one supported, partly supported or not supported. The page draws the six steps as a graph, shows a trace with the time of each step and the tokens and cost of each model stage, and shows the model the provider served. The report can be exported as PDF, Word or Markdown, and each file includes the sources.

What this showcases: a fixed multi-agent pipeline grounded in live public data, and a citation audit that checks each cited claim in the final report against its source and shows the sentence of the source that backs it, or that nothing does.

Each stage's output appears when that stage has finished. The server reads each model reply as it arrives, but it sends a stage to the browser only when that stage ends.

## The pipeline

The step names below are the ones the Run trace shows.

| Step | What it does | Output cap | Time cap |
| --- | --- | --- | --- |
| Retrieve | Searches Wikipedia and Hacker News for the question, in parallel, and numbers what it finds | no model call | 4 s |
| Researcher | Lists three to five key facts, each cited as [n] to a retrieved source | 600 tokens | 5.5 s |
| Analyst | Finds two or three patterns in the research and keeps the citations | 600 tokens | 5.5 s |
| Critic | Names two or three gaps, including claims with no citation or one source | 400 tokens | 4.5 s |
| Synthesizer | Writes the final report from the three outputs. It follows a length or format the question sets, and otherwise aims for 200 to 300 words | 1,200 tokens | 10 s |
| Audit | Separate request after the report: checks each cited sentence against its source (see Citation audit) | 2,400 tokens | 14 s per attempt, 24 s budget |

The time cap is a ceiling for one attempt. The run budget in the next section can shorten it.

### Citation audit

The Audit runs after the Synthesizer, as its own request to `/.netlify/functions/audit` with its own 24 second budget, so it never shortens the research run. The page sends the finished report and the sources it holds, shows "Auditing" while the request is out, and fills in the verdicts when it answers.

1. **Claims.** Every sentence of the report body (the Sources section is left out) that carries a [n] marker is one claim. Sentences are cut at full stops, with a marker after the stop kept with its sentence, and not at abbreviations or decimals. The server and the page run the same code, so they agree on the claim numbers without sending claims back and forth. At most 20 claims are checked; any further ones are listed as not checked and the page says how many.
2. **Pre-pass (no model).** For each claim the code counts the share of its content words found in the text of the sources it cites (the title, the extract and the counts line), and checks that every number in the claim appears in that text (1,200 and 1200 are the same) and that every capitalised name does (a name counts as found when any of its words is there, and months are ignored). A claim that cites a source that is not in the list, or shares no content word with the source it cites, is decided here as not supported, without the model.
3. **Judgment (one Haiku 5.5 call).** The remaining claims go in one call with the numbered extracts. For each claim the model returns supported, partly supported or not supported, the number of the source, one sentence copied from that source, and a reason of at most fifteen words.
4. **Checks the model cannot waive.** The quote is searched for word for word in the cited source (ignoring case, spacing, curly quotes and a trailing ellipsis; at least three words). A quote that is not there is dropped and the claim cannot be "supported": it becomes "partly supported" with the note that the quote was not found. A supported claim whose number or name is in none of the cited sources is also capped at "partly supported", with the missing item named. A claim the model gave no verdict for is "not checked". Nothing is removed from the report.
5. **On the page.** Each cited sentence in the report carries its badge (a shape and a word: check, half circle, cross, dash) and is underlined in its verdict's style, with a thin line for supported and thick, dashed or wavy lines for the rest, so the exceptions stand out. The headline reads "14 of 16 cited claims supported", under it a bar of the four verdicts and a legend with the counts. Selecting a claim opens the source panel: the claim, the reason, each cited extract with the verified quote marked, and the pre-pass in words. On a phone the panel is below the report and the page scrolls to it.

The audit uses the same pinned model constant as the stages, sends no temperature and keeps reasoning off. A hung model call is tried once more when the budget allows and the result says so. The browser ends the audit after 45 seconds, body read included, and shows the failure with a "Try the audit again" button; the sentences stay listed as not checked with their pre-pass. Stop during an audit ends it and says so.

### Retrieval

- **Wikipedia:** one request to `en.wikipedia.org/w/api.php` (`generator=search`, `prop=extracts`, `exintro`, `explaintext`) returns the top three articles with their intro text, cut to 500 characters each.
- **Hacker News:** one request to `hn.algolia.com/api/v1/search` returns stories with more than 20 points. A story is kept only when its title carries enough of the search words, and at most two are kept. Its source text is the title, points, comments and month, which are the facts the API gives.
- **Search words:** the question is cut down to its topic words (question openers and filler are dropped, at most eight kept) before it is sent.
- **Numbering and links:** sources are numbered 1 to n, Wikipedia first. Every link is built by the server from a validated title or numeric id, never copied from the upstream reply.
- **Limits:** both requests run in parallel under one 4 second ceiling, each with its own `AbortSignal.timeout`, and a reply over 200 KB is refused. A dropped connection is tried once more. Retrieval draws on the same 24 second run budget as the model stages, so a slow lookup shortens the stages instead of adding to the run.
- **Honest failure:** if a site fails or finds nothing, the trace says which and why. If no source is found, the Researcher is told so and starts with "No sources retrieved: working from model memory, unverified", the report's Sources section says no sources were retrieved, and the page shows a note. No source is ever made up.
- **Prompt safety:** source text is passed as quoted data and the Researcher is told it is not instructions. The model never writes the Sources list: the server appends it from the retrieved list, so the links cannot be invented.

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
  -> POST /.netlify/functions/ai        body: { "query": "..." }
       Netlify Function (netlify/functions/ai.ts)
         -> Wikipedia and Hacker News search APIs, in parallel (Retrieve)
         -> OpenRouter chat completions, one request per stage
         <- each model reply, read as it arrives
  <- server-sent events: retrieve_start, retrieve_complete, agent_start,
     agent_chunk, agent_complete, agent_skipped, agent_error,
     session_complete, then [DONE]
```

```
Browser, when the report is done
  -> POST /.netlify/functions/audit     body: { "report": "...", "sources": [...] }
       Netlify Function (netlify/functions/audit.ts)
         -> pre-pass (src/lib/audit.ts), then one OpenRouter call for the claims it cannot decide
  <- one JSON body: claims with verdicts and verified quotes, summary, usage, model, time
```

- **Keys:** `OPENROUTER_API_KEY` is read only on the server, in `netlify/shared/provider.ts`. The browser never receives it.
- **Model:** one server constant, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned. The page has no model picker, and a model field sent by a client is ignored.
- **Every provider call:** sends an explicit `max_tokens` and asks for usage, including cost. Reasoning is switched off, because reasoning tokens count against `max_tokens`.
- **Where the logic lives:** retrieval (URLs, parsing, caps, timeouts) is in `netlify/shared/retrieve.ts`. The four stage prompts and caps are in `netlify/shared/agents.ts`. Reading the provider reply and retrying are in `netlify/shared/stream.ts`. Request checks are in `netlify/shared/gate.ts`.

### Request checks

- Only POST runs a research. Other methods get a 405. The browser's OPTIONS preflight gets a 204 for an allowed origin.
- A browser request from an origin that is not the site's own host and not listed in `ALLOWED_ORIGINS` gets a 403. Requests with no Origin header are not blocked by this check.
- The audit endpoint answers POST only, with the same origin and per-address rate checks (its own counter). Its body is JSON of at most 40 KB: a report of at most 8,000 characters and up to 8 sources numbered from 1, each with a title and at most 500 characters of text. Anything else gets a 400.
- The body must be JSON of at most 8 KB. `query` must be text of 1 to 500 characters after trimming. Anything else gets a 400.
- Each client address gets 10 requests a minute, and the eleventh gets a 429. The count is kept in memory, so the limit is best effort: each warm function instance keeps its own count.
- Every error is JSON with one plain-language `error` field. An unexpected failure returns a generic 500 message and no detail.

### Time limits and retries

- One run has a 24 second budget shared by Retrieve and all four stages. That budget is the real bound on a run. Netlify's synchronous function limit is 60 seconds and cannot be configured, so the budget always ends a run first.
- Each attempt is capped at the stage's own time cap and at what is left of the run budget. A stage does not start with less than 2 seconds left, and it is then marked Not run.
- A stage gets at most one retry. The retry happens when the reply was empty or cut off, when the provider returned 429 or a 5xx with no text, when the call hung until its time cap before any answer, or when the connection failed outright. A rejected request (4xx other than 429) and a stop by the visitor are never retried. A hung call is retried at once, a failed one after 0.8 s, and only when 2 seconds of the budget remain. The result carries why it was retried and the trace shows it. Once headers arrive, a body that is cut off is retried if the budget allows, and any text that already arrived is kept. A retry does not start with less than 2 seconds of budget left. If the retry delay leaves too little budget, the provider's own 429 or 5xx is reported, not a timeout.
- Usage from both attempts is added together when both report it, because a retry is billed too. If an attempt reports no usage, the stage shows its figures as not reported.
- In the browser, the server has 15 seconds to answer, the stream may stay silent for at most 30 seconds between reads, and the whole run is ended after 60 seconds (the 24 second budget plus a wide margin), each with a plain message. The audit request is ended after 45 seconds, body read included. Stop stays silent.

### Messages a visitor can see

| Situation | Message |
| --- | --- |
| Provider returns 401, 402 or 403 | The AI provider rejected the key or is out of credit. |
| Provider returns 429 | Rate limited, try again in a minute. |
| Provider returns 5xx or 408, or times out | The AI provider did not answer in time. |
| A stage returns no text after its retry, and its last attempt timed out | The AI provider did not answer in time. |
| A stage returns no text after its retry, for another reason | {Stage} returned no text. Try again. |
| A stage fails for another reason | {Stage} could not finish. Try again. |
| Wikipedia or Hacker News fails or finds nothing | Not an error. The trace line and the Retrieve tab say what happened, and the run goes on without those sources. |
| The browser cannot reach the server | Could not reach the server. Check your connection and try again. |

Raw provider bodies, stack traces and key material are never shown.

## Run it locally

Environment variable names. Set the values in your own shell or in the Netlify site settings:

- `OPENROUTER_API_KEY`: required for real runs. Server only.
- `OPENROUTER_URL`: optional. Defaults to OpenRouter's chat completions endpoint.
- `ALLOWED_ORIGINS`: optional. Extra browser origins, comma separated, allowed to call the function.

```bash
npm ci
npm run dev        # UI only. Vite proxies /.netlify/functions to localhost:8888, so research runs fail here.
npx netlify dev    # UI and functions together on localhost:8888. Needs the Netlify CLI.
```

Checks, none of which call a real provider or a public API:

```bash
npm test           # unit tests and function smoke tests. The provider, Wikipedia and Hacker News are mocked with fetch stubs.
npm run lint
npm run typecheck
npm run build
```

Tests live in `tests/unit` (the audit's claim extraction, pre-pass, quote verification, verdict rules and summary; the audit request checks and verdict parsing; the page's audit client; rendering of the badges, summary, panel and report states; retrieval URLs, parsing and degradation with recorded-shape fixtures, source numbering and the Sources section, graph layout and trace rows, stage definitions, request checks, frame parsing, retry and deadline rules, usage math, markdown, export text, and the browser's event parser) and `tests/server` (the research function's full response, read frame by frame, and the audit function end to end with a mocked provider).

## Live site

https://jdgafx-app-01-multi-agent-orchestrator.netlify.app

## Known limits

- Output arrives one stage at a time, when that stage ends. It does not arrive token by token.
- Stop ends the browser's request. The server then cancels the run: the model call in flight is aborted and no later stage starts. Tokens already generated may still be billed.
- The rate limit is per warm function instance. It resets when an instance restarts.
- Token counts and cost come from the provider's usage report. When the provider sends no figure, the page says "not reported".
- The served model is the one OpenRouter reports in its reply. The request pins one model, so they should match; the page shows what OpenRouter reports.
- The audit checks citations, not truth. It judges each claim against the extract of the source it cites (at most 500 characters of a Wikipedia intro, or the title and counts of a Hacker News story), so a claim the article supports further down shows as partly or not supported, and the panel says when an extract is cut. The verdicts come from one model and its quotes are verified word for word, but the verdicts themselves have no labelled evaluation set yet.
- The audit trusts the sources the page sends with the report. It does not fetch them again, so a caller who edits that request can audit against text of their choosing. That affects only the caller's own audit.
- A claim about the research itself (for example "this rests on a single source") cites a source but is not stated in it, and shows as not supported.
- Only cited sentences are audited. An uncited sentence in the report is not judged, and the Synthesizer is told to leave analysis and critique uncited.
- Retrieval is keyword search over Wikipedia article intros and Hacker News titles. A Hacker News source carries only the title and counts, not the discussion. A question with no good Wikipedia article gets weak sources.
- Retrieval can take up to 4 seconds of the 24 second budget, which leaves the Synthesizer less time.
- On a slow provider the Synthesizer can be cut off or not run inside the 24 second budget. The page marks those stages.
- A stage cut off before its finish reason keeps its text and is labelled cut off in the trace, the graph and the report.
- An error before the stream starts, such as an unreachable server, appears in the alert. No stage is marked failed in that case, because none has started.
- There is no demo recording yet.
- The research text is cut to 1,500 characters when the Analyst and Synthesizer read it, so a long research output can lose its last citation there.
