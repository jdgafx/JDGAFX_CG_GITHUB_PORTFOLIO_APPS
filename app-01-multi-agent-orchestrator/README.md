# AgentFlow: multi-agent research orchestrator

AgentFlow answers one research question from live public sources. A Retrieve step first looks the question up on Wikipedia and Hacker News. Then four model calls run in a fixed order. A Researcher lists key facts from those sources with [n] citations, an Analyst finds patterns in them, a Critic names gaps, and a Synthesizer writes the final report from those three outputs. The report keeps the citations and ends with a Sources list of links. The page draws the five steps as a graph, shows a trace with the time of each step and the tokens and cost of each model stage, and shows the model the provider served. The report can be exported as PDF, Word or Markdown, and each file includes the sources.

What this showcases: a fixed multi-agent pipeline grounded in live public data, with every step traced and every claim in the report tied to a numbered source.

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

The time cap is a ceiling for one attempt. The run budget in the next section can shorten it.

### Retrieval

- **Wikipedia:** one request to `en.wikipedia.org/w/api.php` (`generator=search`, `prop=extracts`, `exintro`, `explaintext`) returns the top three articles with their intro text, cut to 500 characters each.
- **Hacker News:** one request to `hn.algolia.com/api/v1/search` returns stories with more than 20 points. A story is kept only when its title carries enough of the search words, and at most two are kept. Its source text is the title, points, comments and month, which are the facts the API gives.
- **Search words:** the question is cut down to its topic words (question openers and filler are dropped, at most eight kept) before it is sent.
- **Numbering and links:** sources are numbered 1 to n, Wikipedia first. Every link is built by the server from a validated title or numeric id, never copied from the upstream reply.
- **Limits:** both requests run in parallel under one 4 second ceiling, each with its own `AbortSignal.timeout`, and a reply over 200 KB is refused. A dropped connection is tried once more. Retrieval draws on the same 24 second run budget as the model stages, so a slow lookup shortens the stages instead of adding to the run.
- **Honest failure:** if a site fails or finds nothing, the trace says which and why. If no source is found, the Researcher is told so and starts with "No sources retrieved: working from model memory, unverified", the report's Sources section says no sources were retrieved, and the page shows a note. No source is ever made up.
- **Prompt safety:** source text is passed as quoted data and the Researcher is told it is not instructions. The model never writes the Sources list: the server appends it from the retrieved list, so the links cannot be invented.

## What the page shows

- **Controls:** the research topic, Start research, Stop research while a run is going, and the export group. Export offers PDF, DOCX or Markdown once a run has output, and each file holds all four stages and the sources. The example questions are ones Wikipedia and Hacker News can ground.
- **Pipeline:** one node per step, labelled Waiting, Working, Finished, No sources, Cut off, Failed, Not run or Stopped. A node shows its time once its step has finished. The edges are labelled Sources, Research, Analysis and Gaps, and an edge takes the signal colour once a run passes along it. The five steps snake three to a row, and two to a row below 640 px.
- **Report:** one tab per step. The Retrieve tab lists the sources (title, site, link and the text the Researcher saw). The other tabs show text once their stage has finished, [n] markers in the text link to their source, and the Synthesizer tab holds the final answer with its Sources list.
- **Run figures:** total latency, prompt, completion and total tokens, cost in USD, and the served model. A figure the provider did not send shows as "not reported". The page never estimates one. Retrieval is not a model call, so it adds no tokens or cost.
- **Run trace:** one numbered line per step with its status, a one-line summary, its time in milliseconds, and for finished model stages their tokens and cost. Retrieve shows how many sources it found. A stage whose reply stopped before its finish reason shows as cut off.

## Architecture

```
Browser (React, Vite, React Flow graph)
  -> POST /.netlify/functions/ai        body: { "query": "..." }
       Netlify Function (netlify/functions/ai.ts)
         -> Wikipedia and Hacker News search APIs, in parallel (Retrieve)
         -> OpenRouter chat completions, one request per stage
         <- each model reply, read as it arrives
  <- server-sent events: retrieve_start, retrieve_complete, agent_start,
     agent_chunk, agent_complete, agent_skipped, agent_error,
     session_complete, then [DONE]
```

- **Keys:** `OPENROUTER_API_KEY` is read only on the server, in `netlify/shared/provider.ts`. The browser never receives it.
- **Model:** one server constant, `~anthropic/claude-haiku-latest`. The page has no model picker, and a model field sent by a client is ignored.
- **Every provider call:** sends an explicit `max_tokens` and asks for usage, including cost. Reasoning is switched off, because reasoning tokens count against `max_tokens`.
- **Where the logic lives:** retrieval (URLs, parsing, caps, timeouts) is in `netlify/shared/retrieve.ts`. The four stage prompts and caps are in `netlify/shared/agents.ts`. Reading the provider reply and retrying are in `netlify/shared/stream.ts`. Request checks are in `netlify/shared/gate.ts`.

### Request checks

- Only POST runs a research. Other methods get a 405. The browser's OPTIONS preflight gets a 204 for an allowed origin.
- A browser request from an origin that is not the site's own host and not listed in `ALLOWED_ORIGINS` gets a 403. Requests with no Origin header are not blocked by this check.
- The body must be JSON of at most 8 KB. `query` must be text of 1 to 500 characters after trimming. Anything else gets a 400.
- Each client address gets 10 requests a minute, and the eleventh gets a 429. The count is kept in memory, so the limit is best effort: each warm function instance keeps its own count.
- Every error is JSON with one plain-language `error` field. An unexpected failure returns a generic 500 message and no detail.

### Time limits and retries

- One run has a 24 second budget shared by Retrieve and all four stages. That budget is the real bound on a run. Netlify's synchronous function limit is 60 seconds and cannot be configured, so the budget always ends a run first.
- Each attempt is capped at the stage's own time cap and at what is left of the run budget. A stage does not start with less than 2 seconds left, and it is then marked Not run.
- A stage gets at most one retry. The retry happens only when the reply was empty or cut off, or when the provider returned 429 or a 5xx with no text. A timeout before the response headers arrive is not retried. Once headers arrive, a body that is cut off is retried if the budget allows, and any text that already arrived is kept. A retry does not start with less than 2 seconds of budget left. If the retry delay leaves too little budget, the provider's own 429 or 5xx is reported, not a timeout.
- Usage from both attempts is added together when both report it, because a retry is billed too. If an attempt reports no usage, the stage shows its figures as not reported.
- In the browser, the server has 15 seconds to answer, and the stream may stay silent for at most 60 seconds between reads.

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

Tests live in `tests/unit` (retrieval URLs, parsing and degradation with recorded-shape fixtures, source numbering and the Sources section, graph layout, stage definitions, request checks, frame parsing, retry and deadline rules, usage math, markdown, export text, and the browser's event parser) and `tests/server` (the function's full response, read frame by frame).

## Live site

https://jdgafx-app-01-multi-agent-orchestrator.netlify.app

## Known limits

- Output arrives one stage at a time, when that stage ends. It does not arrive token by token.
- Stop ends the browser's request. The server then cancels the run: the model call in flight is aborted and no later stage starts. Tokens already generated may still be billed.
- The rate limit is per warm function instance. It resets when an instance restarts.
- Token counts and cost come from the provider's usage report. When the provider sends no figure, the page says "not reported".
- The served model is the one OpenRouter reports in its reply. The request names an alias, so the two can differ.
- Output quality is not checked. A citation is the model's claim that a fact comes from source n. Nothing verifies it, and there is no labelled evaluation set yet.
- Retrieval is keyword search over Wikipedia article intros and Hacker News titles. A Hacker News source carries only the title and counts, not the discussion. A question with no good Wikipedia article gets weak sources.
- Retrieval can take up to 4 seconds of the 24 second budget, which leaves the Synthesizer less time.
- On a slow provider the Synthesizer can be cut off or not run inside the 24 second budget. The page marks those stages.
- A stage cut off before its finish reason keeps its text and is labelled cut off in the trace, the graph and the report.
- An error before the stream starts, such as an unreachable server, appears in the alert. No stage is marked failed in that case, because none has started.
- There is no demo recording or pipeline diagram yet.
- The research text is cut to 1,500 characters when the Analyst and Synthesizer read it, so a long research output can lose its last citation there.
