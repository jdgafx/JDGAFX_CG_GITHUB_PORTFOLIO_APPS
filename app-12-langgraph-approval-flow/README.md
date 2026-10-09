# GraphGate

GraphGate triages live public GitHub issues with a LangGraph.js graph. The visitor picks a repository and one of its newest open issues. The graph classifies the issue, applies fixed rules, and either triages it alone or pauses for a maintainer. The maintainer approves, edits the labels and priority, or rejects. The run resumes and drafts the comment a maintainer could post.

Draft only: nothing is posted to GitHub. No label, priority or comment is applied there. The page and this README say so wherever a draft appears.

The graph needs LangGraph because the pause has to survive a reload. The run stops at an `interrupt()` call and writes its state to a checkpoint in Netlify Blobs. A visitor can close the page, come back, see the thread listed as waiting, and resume it from that checkpoint. A plain chain cannot stop mid-run and continue later from stored state.

What this showcases: duplicate detection that shows its evidence, and a graph that pauses for a human with `interrupt()`, saves its checkpoint, and resumes from it after a reload.

## Live data

The masthead carries a chip "Live data: GitHub". It is hollow until GitHub has answered, lights up green with the fetch time ("fetched 14:32") once an issue list or issue was fetched and parsed, and turns red ("Live data unavailable: GitHub") when the issue fetch fails or the duplicate search cannot reach GitHub. Its tooltip names the host: `api.github.com`, fetched by the browser for issues and by the server for the search. The model's text is never counted as data. Nothing canned is reachable: there are no sample issues, demo results or fallback data in `src/` or `netlify/` (a test scans for them), and a failed fetch shows an error with a way to retry. The preset repositories are only inputs.

## Duplicate detection

Before the rules decide, a `duplicates` step looks for earlier issues in the same repository that say the same thing. It has three parts, and only the last uses a model.

1. **Search (GitHub, server side).** The title's words are ranked rarest first (words that fill every software issue, such as "module" or "error", and the repo's own name go last or are left out). Two GitHub issue searches run in parallel over the repo's open and closed issues: a strict one on the two rarest words together, and a broad one on any of up to five words. Each returns up to 30 issues with their text. The issue itself and pull requests are dropped.
2. **Rank (rules, no model).** Candidates are ranked by cosine similarity of rare-term weights. A term's weight is `ln(1 + N/df)`, with `df` counted over the issue and all candidates, so a word every result shares says little. A word in the title counts double. The issue body is read without its comments, links, `<details>` blocks and the machine-info sections of the issue templates (System Info, Logs and similar), so a reporter's graphics card does not make two issues look alike. The same issue and results always give the same order. The top five are shown. Only candidates with a score of at least 0.12 and two shared words are judged, at most three.
3. **Judge (model).** One `anthropic/claude-haiku-5.5` call sees the issue and the judged candidates as JSON data, and returns for each one `duplicate`, `related` or `not`, a one-line reason, and one passage copied from each issue.

**Quotes are checked.** A `duplicate` or `related` verdict stands only when both passages are found, word for word, in the texts the model was given (case, punctuation and spacing are ignored; a quote under twelve characters never counts). If a passage is missing, the verdict becomes "Not accepted", the model's claim is shown as unverified, and nothing else happens. The page shows both quotes and a line saying they were found.

**What a confirmed duplicate changes.** When the best accepted duplicate exists, the rules add the reason and the label `duplicate`, and the proposal becomes "close as duplicate of #N". That always pauses for a maintainer, even for a low-severity bug. Approve keeps the action; Edit sets labels and priority only and drops it; Reject applies nothing. The draft comment must name `#N` as plain text, and the existing draft guard still rejects any claim that something was closed, because nothing is posted. A candidate that GitHub itself closed as a duplicate is used only when no other accepted duplicate exists, since its original is one step further.

**Rate limits.** With `GITHUB_TOKEN` set on the site, the server searches as that account: 30 searches a minute, and the message says "30 searches a minute". Without it the search is unauthenticated: 10 a minute per egress address, and the message says "10 searches a minute without a token". Netlify functions may share an address, though a live test with 24 searches inside a minute did not reach the limit, so how shared it is varies. A 403 or 429 reads "GitHub's search limit (...) is used up. Try again in about N seconds.", the step is marked failed, and the triage continues without a duplicate check. The step also skips itself when under 10 seconds of the 25-second budget remain.

You can triage any public issue, open or closed: type `owner/name#123` or paste an issue link in the repository field. That is how a known duplicate pair can be tried.

## Data

The issues are real and are fetched live, in the visitor's browser, from `https://api.github.com/repos/{owner}/{repo}/issues`. GitHub allows cross-origin reads and gives each anonymous visitor 60 requests an hour. Netlify functions share addresses, so the server never calls GitHub. A rate limit shows the reset time from GitHub's `X-RateLimit-Reset` header.

- Five well-known repos are one click each: `react/react` (formerly facebook/react), `vitejs/vite`, `microsoft/vscode`, `denoland/deno` and `langchain-ai/langgraphjs`. Any other public repo can be typed as `owner/name` or pasted as a github.com link.
- The list shows the 25 newest open issues. Pull requests share the endpoint and are dropped. Each row shows the number, title, labels, age and comment count.
- The page sends the chosen issue to the server: repo, number, title, body (cut to 6,000 characters), labels, author association, created date, link and comment count.

The issue text reaches the server from the visitor's browser, so it is unverified. The server checks every field at the boundary and treats the text as untrusted data.

## The graph

```text
START -> classify -> duplicates -> decide --requiresHuman--> review -> reply -> END
                                      |                         ^
                                      +-------otherwise---------+
```

- **classify** (model): reads the issue into a fixed shape: type (bug, feature, question, docs, other), area, severity, flags for unclear, likely duplicate and possible security report, a confidence from 0 to 1, and a one-sentence summary.
- **duplicates** (search, rules, model): finds and judges likely duplicates, as described above. A failure here never fails the run.
- **decide** (rules, no model): proposes labels and a priority, and decides whether a maintainer must look. The same issue and classification always give the same verdict.
- **review** (human): calls `interrupt({ issue, classification, triage })`. The run stops here until resumed with `approve`, `edit` or `reject`.
- **reply** (model): drafts the maintainer comment for the final outcome. The model is told the outcome is final, so a draft that calls it pending is replaced by fixed wording, and the trace says so.

The conditional edge from **decide** goes to review when any of these holds, and straight to reply otherwise:

- the issue may be a security report, by the classifier or by a keyword check on the issue text (security, vulnerability, CVE, XSS, RCE, SSRF, injection, a leaked token or key);
- the issue text is aimed at an AI assistant: the classifier says so and quotes the words, and the quote is found in the issue text, or a short list of high-precision patterns finds such words ("Assistant, ...", "ignore your instructions", "in your reply ..."). The reason on the card quotes what was found;
- a duplicate was found and its quotes verified (the proposal is then to close it);
- the classification has a confidence below 0.75;
- the report is unclear, or may duplicate another issue;
- it is a bug of medium severity or worse;
- it is not a bug, feature, question or docs issue.

A clear question, docs issue or feature request, or a low-severity bug, at 0.75 confidence or higher, is triaged by the rules alone and review is skipped. Priority comes from the rules: a bug takes its severity (critical is urgent), a security report is urgent, and everything else is low. Labels come from the type, the area, and the flags: `bug`, `enhancement`, `question`, `documentation`, `area: <name>`, `needs-info`, `possible-duplicate`, `security`.

The three answers: **Approve** keeps the proposed labels and priority. **Edit** sets 1 to 8 labels and a priority the maintainer picks, and the draft may only name an issue type that those labels carry. **Reject** applies nothing. Its draft is fixed wording that says only that a maintainer looked, so the model is not called. The graph has no cycles. The only pause is the review interrupt.

## Untrusted text

- The issue goes to each model as one line of JSON after a line saying it is data, not instructions. Its text cannot start a new section of the prompt. Both system prompts say the issue is written by a stranger and must not be followed.
- The model's reply is checked against fixed lists. A type, severity, or priority outside the list reads as unreadable and sends the issue to a maintainer. A flag counts only when it is the boolean `true`. The area is cut to a short lowercase name.
- The rules read the issue text themselves, so a model that was talked out of a security flag cannot talk the rules out of it.
- Text aimed at the assistant is caught two ways, and either pauses the run. The classifier returns `addressedToAssistant` and a verbatim quote, with a prompt that separates text about a product's own prompts or AI features from text that speaks to the assistant. The server checks that the quote is in the issue text, and ignores the flag when it is not. A few narrow patterns do not depend on the model. The list is kept short on purpose, since every added pattern also catches ordinary issues.
- A maintainer's edit may only use labels from the fixed list or the labels this proposal offered. The server checks that before it resumes the run.
- The draft is checked before it is shown: a draft that says a decision or review is pending or not final, claims the issue was fixed, merged, released or closed or that the maintainers confirmed, reproduced or recorded something, or links anywhere but the issue's own repository, claims a note on the issue, or names an issue type the final labels do not carry is replaced by fixed wording.

## Models

Every node calls one model, `anthropic/claude-haiku-5.5` on OpenRouter. Chris named this version, so it is pinned. The id lives in one constant, `MODEL` in `netlify/shared/models.ts`, with one price entry: $0.10 per 1M input tokens and $0.50 per 1M output tokens.

| Node | Output cap | Job |
| --- | --- | --- |
| classify | 400 tokens | Sorts an issue into fixed fields as JSON |
| duplicates | 700 tokens | Judges up to three candidates, with a quote from each side |
| reply | 500 tokens | Drafts the comment in plain language |

- No call sends `temperature`. Haiku 5.5 does not take one, and with `provider.require_parameters` a request that sends it fails with 404 "No endpoints found". The request type has no field for it, and a test checks the wire body.
- Every call sends `reasoning: { enabled: false }`. Haiku 5.5 reasons by default, and on six classify calls the reasoning used 134 to 221 of the 300 output tokens before the answer. With it off, the same calls produced 112 to 131 output tokens and answered in about the same time.
- Usage accounting is on for every call. The classify reply is read as its first complete JSON object, so a code fence or prose around it still works. The UI shows the cost OpenRouter reports. When it reports none, the UI estimates from the list price and labels the figure "estimated".

Measured on 2026-10-09 with 13 real issues from vite, deno and vscode, run through the real graph (nearest-rank percentiles; the sample is small):

| Step | p50 | p95 | max |
| --- | --- | --- | --- |
| classify call | 1.7 s | 3.0 s | 3.0 s |
| reply call | 1.6 s | 3.0 s | 3.0 s |
| start request (classify, decide, and reply when automatic) | 2.2 s | 5.0 s | 5.0 s |
| resume request (review and reply) | 1.6 s | 2.0 s | 2.0 s |

The figures are healthy-call times. A live probe run also showed a different failure: 2 of about 26 classify calls hung until the then 12-second limit. That is a hang tail, not slowness, since p95 is about 3 seconds. So a model call has an 8-second limit, and a call that times out or loses its connection is made once more with the same limit. The retry happens only when the budget has room for it and for the model calls still to come (8 s for the retry, 3 s for each later call, 1 s margin). A rejected key, a 4xx, a rate limit and a budget stop are never retried. The trace row says "Retried once after 8 s timeout". If the retry hangs too, the run fails with a message that says so, and Retry continues from the checkpoint. The worst start request is two hung classify calls (16 s) followed by one reply call (8 s), 24 s, under the 25-second budget. The figures do not include Blobs latency on Netlify.

Measured on 2026-10-09 with 15 real issues from vscode and vite (the duplicates step, GitHub search included): 0.65 to 1.1 s when no candidate was worth asking the model about (4 runs), and 2.3 to 3.9 s with the judge call (11 runs, median 3.1 s). The step adds that to the start request. A hung judge call is retried like the others, when the budget has room (8 s for the retry, 3 s each for the judge and the reply still to come, and 1 s margin, so 15 s for classify and 12 s for the judge); a judge call that fails for any reason costs only the verdicts.

Forced slow provider, checked on 2026-10-09 by wrapping `fetch` so the first OpenRouter call never answers and ignores its abort: the classify row read "Retried once after 8 s timeout. Read as bug ...", took 9.8 s, and the run finished in 15.5 s. With every call hanging, the run failed after 16.2 s with "The AI provider did not answer within 8 seconds during the classify step, even after one automatic retry. Finished steps are saved, so you can retry the thread."

## What the UI shows

- **Repository and issue**: the well-known repos, a field for any public repo or one issue (`owner/name#123` or a link, open or closed), and the issue list as a choice list. The Triage button and Stop sit in a dock at the bottom of the rail. Saved threads are a disclosure that opens by itself when one is waiting.
- **Approval card** (or the finished **triage card**) leads the result column once a run ends or pauses, and takes focus on a phone. The approval card shows why the graph paused, the proposed action, labels and priority, and Approve, Edit and Reject. Edit shows label checkboxes and a priority select. A note is optional.
- **Duplicate check**: what was searched, the ranked candidates with their similarity, state, shared words, the model's verdict and reason, and the two quotes with the line saying they were found in the texts. A verdict whose quotes were not found is shown as "Not accepted".
- **Graph**: the five steps as the run walks them, drawn wide on a desktop and as a column on a phone. The two decide edges are labelled "needs a maintainer" (`requiresHuman` in the code) and "auto-triage" (`otherwise`).
- **Readout** and **run trace**: each step with its time, a bar for when it ran, served model, tokens and cost. A value the provider did not report reads "not reported".
- **Failed and stopped runs**: a failed run offers Retry, which continues from the checkpoint and runs only the step that failed. Stop ends the page's wait; the server may still finish the thread, so the page says to check Saved threads.
- **Threads**: the saved threads, most recently updated first. Open a waiting thread to review it after a reload: the page scrolls to its card and moves focus there.

## Architecture

Browser, then Netlify Functions, then OpenRouter and Netlify Blobs. GitHub is called by the browser only.

- `POST /api/start` takes `{ issue }`. It streams server-sent frames: `thread`, then `node_start`, `node_end`, `edge`, then `interrupt` or `result`, then `[DONE]`. A bad issue gets 400 before any model call.
- `POST /api/resume` takes `{ threadId, decision }`. It streams the rest of the run from the checkpoint. A thread that is not waiting, or that another run holds, gets 409. The classify call is not repeated: the resumed run reads it from the checkpoint.
- `POST /api/retry` takes `{ threadId }`. It continues a failed thread from its last checkpoint and streams like resume. The classification and a maintainer's answer are read from the checkpoint and not run again. A thread that did not fail, has no saved step, or is held by another run gets 409.
- `GET /api/threads` returns the thread list and where checkpoints are kept.
- `GET /api/thread?id=` returns one thread's status, issue, pending proposal and result.
- Validation of the issue: `repo` is `owner/name`; `number` is a positive integer; the title is 1 to 300 characters; the body is text of at most 6,000 characters; there are at most 30 labels of 50 characters; `authorAssociation` is one of GitHub's values; `createdAt` is a UTC ISO time; and the link must equal `https://github.com/{repo}/issues/{number}` exactly. Control characters are removed from text.
- Checkpoints use the `graphgate-checkpoints` Blobs store, with keys under `thread/<id>/`. They are the source of truth for a thread.
- The thread list is one small summary blob per thread, written only by the run that owns that thread. Nothing is read, changed and written back as a shared document, so runs at the same moment cannot overwrite each other. The key is `threads/<threadId>`. Thread ids are UUIDs that start with the creation time, so the keys sort by age. A thread saved before that has a random id and its summary key starts with the time it was first written. A plain `threads/<random id>` written by an earlier version is moved to the time-ordered key by the next write or by the list. A thread that awaits a maintainer also has an empty marker at `waiting/<threadId>`.
- The list shows at most 50 threads: waiting threads first, then the most recently updated. Every write of a summary also leaves an empty marker `updated/<time of the write>-<threadId>` and removes the one the previous write left, again only by the run that owns the thread. The marker keys sort by update time, so the 50 are picked from the key listing by update time, the same order the rows are sorted in. Threads saved before markers existed follow in creation order, which is their update order too. The summaries are read 8 at a time with a 4-second limit each and a 6-second budget for the whole list. A read that times out is tried once more when at least 1.5 seconds of the budget remain. A summary that still cannot be read costs one row: it is skipped and logged with its key and the store's own error. If every read fails, the call fails with 503 and a plain message, so a store that is down does not look like an empty list. A failed key listing is logged on its own line.
- A row is listed as waiting only if the thread's waiting marker exists. A row that says waiting without a marker is checked against its checkpoint (up to 5 per call), which also rewrites its summary and marker, so a frozen row cannot keep a finished thread at the top. A repair keeps the row's old time, so it does not jump to the top.
- Threads of earlier versions are merged in: the legacy index rows, and the plain `threads/<random id>` summaries, which are read so the newer copy wins. Up to 5 plain summaries are moved to time-ordered keys on each list call, keeping their own update time, until none are left. One row per thread, the newest copy winning, sorted by update time before the cap, so old rows cannot crowd out new threads.
- A thread's status comes from its checkpoint: stopped at the interrupt means awaiting a maintainer, finished with a reply means completed, anything else means failed. A finished thread's priority comes from its result, which is none for a rejection. The summary supplies the title and speeds up the list. When a summary is missing or disagrees with the checkpoint, opening the thread rewrites it. A lost or late summary write therefore cannot strand a thread: resume and retry read the checkpoint, not the summary.
- One run at a time per thread, across function instances. Start, resume and retry take a claim first: a blob at `claims/<threadId>` written with `onlyIfNew`, so of several callers the store lets one win. The claim holds the time it was taken. It is released when the run ends. A run that crashes never releases it, so a claim older than 60 seconds is taken over, with a write that names the tag it read (`onlyIfMatch`). The loser gets 409 "Another maintainer is handling this thread. Refresh to see the result." While a claim is live, the thread view reports the status `running`: no failure is guessed from the mid-step checkpoint, no summary is written, and no Retry is offered. The claim is released once the thread's summary is written and before the closing frame (interrupt, result or error) is sent, so an answer sent the moment the card appears is accepted. A 409 on an answer is shown as the thread's current state, not as a failed run: the page opens the thread again. If the other maintainer's run is still going, a neutral notice with a Refresh button appears, and the page checks every 2 seconds, up to 10 times, then shows the result card.
- A summary write that fails is tried twice and logged with the thread id. The single `threads/index` document of earlier versions is read as a fallback for listing and opening threads saved before summaries existed, and is never written again.
- The checkpoint saver imports its base class, `WRITES_IDX_MAP` and checkpoint types from `@langchain/langgraph-checkpoint`. That package is therefore a direct dependency, pinned to the version `@langchain/langgraph` already uses.
- Every request makes its own Blobs store. The token that `getStore` reads belongs to one invocation and expires after about 15 minutes, so a store kept by a warm instance goes bad ("Token expired"). As a second line, a call that fails with that error builds a new store and is tried once more. The in-memory fallback is the only store kept for the life of the process.
- The OpenRouter key is read only on the server. A missing key returns 503 before any model call.
- Requests from unknown origins get 403, and wrong methods get 405. A request with no Origin header passes. Bodies over 32 KB get 413. Each client address gets 20 starts or resumes a minute.
- One request has a 25-second budget, because Netlify closes these functions at about 30 seconds in practice. Each model call has 8 seconds, with one automatic retry when it hangs or loses its connection and the budget has room. Each checkpoint or summary call has 8 seconds. Every call also stops when the budget ends. A stalled call, or a run that uses the whole budget, fails the run with a plain message, marks the thread failed, and the stream still ends with `[DONE]`. The final summary write has its own 8-second limit and is not counted in the budget.
- Deadlines are timers that settle a race with the whole exchange, the body read included, and they also abort the fetch. A reply whose body never finishes is cut at the limit even if the fetch ignores its abort signal. The same holds for the browser's GitHub request (10 seconds) and for every store call. Nothing relies on `AbortSignal.timeout` alone.
- A stop says what ended it. A call that passes 8 seconds, after its retry, reads "The AI provider did not answer within 8 seconds during the classify step, even after one automatic retry." A run that uses its 25-second budget reads "The run reached its 25-second budget during the reply step and was stopped." Both add that finished steps are saved.
- A failed run keeps its checkpoint. The thread is marked failed and listed, and Retry continues it.
- The page's Content-Security-Policy allows `https://api.github.com` in `connect-src`, and nothing else beyond the page itself. The page shows no avatars, so `img-src` is unchanged.
- A failure is sent as an `error` frame with plain-language text. The trace marks the step that failed.

## Run locally

```bash
npm ci
npm run dev          # UI only; running a triage needs the functions
npx netlify dev      # UI and functions on port 8888, with Blobs when the site is linked
```

Environment variable names:

- `OPENROUTER_API_KEY`: required for runs. Set it in the shell or in the Netlify site settings.
- `ALLOWED_ORIGINS`: optional, comma-separated extra origins for the functions.
- `GITHUB_TOKEN`: optional, server side only. Used for the duplicate search (30 searches a minute instead of 10).
- `NETLIFY_BLOBS_CONTEXT`: set by Netlify. Without it the server keeps checkpoints in memory and the page shows a notice.

Checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

The tests mock the model and the store. They cover the graph paths with a mocked model (auto-triage, pause then approve, edit, reject, and resume from a fresh checkpointer over the same store), the retry of a failed thread, the call and budget deadlines (including a reply whose body never finishes), the rules, the boundary validation of the issue and of the decision, the parsing of a recorded GitHub response, the draft guard, the per-thread summaries (ten writes at the same moment all stay; a stale summary against a finished checkpoint shows the result; a failing read costs one row), the claims (one of ten racing callers wins, a stale claim is taken over, a retry during a resume is refused), and the legacy index fallback. The recorded GitHub response exists only in the tests. The app fetches live.

Live URL: https://jdgafx-app-12-langgraph-approval-flow.netlify.app

## Known limits

- Duplicate search is lexical. GitHub matches words, so two issues that describe one problem in different words are not found. In the live runs, vscode #334679 and #334690 (closed as duplicates of #334106) and vite #21893 (closed as a duplicate of #21849, which never uses its words) did not reach the candidates.
- The model is cautious. It answered "related" for pairs that maintainers closed as duplicates (vscode #286505 of #183972, for instance) when the reports gave different symptoms. A missed duplicate costs nothing; a wrong one would cost a maintainer's time, so it leans that way.
- A verified quote proves the words exist, not that they prove the claim. The quotes are shown so a maintainer can judge them. A candidate that GitHub closed as a duplicate may point at an issue that is itself part of a cluster; the page says "Closed as a duplicate on GitHub".
- Candidates are the best 30 matches of each search over all time, not only recent issues, and only the top three are judged. Unauthenticated, the search limit is 10 a minute per egress address, and visitors may share one. Set `GITHUB_TOKEN` on the site for 30 a minute.
- The classification is a model's reading of text a stranger wrote. A crafted issue may push the model to call itself confident. The rules catch security wording and text aimed at an assistant, and the draft is checked, but a clear-looking issue can still be triaged without a maintainer. The result is a draft that nothing posts.
- The page has no sign-in. Anyone with the URL can run issues and answer reviews.
- GitHub's anonymous limit is 60 requests an hour per visitor address, for the browser's issue lists. Loading a repo or one issue costs one request.
- Pull requests are dropped after the fetch, so a repo with many open pull requests lists fewer than 25 issues.
- The issue text is cut to 6,000 characters before it is sent. The reply call sees the first 1,500.
- Threads saved by the earlier refund version of this app have a different shape. The thread list skips them, so they cannot be opened or resumed.
- The rate limit counts per function instance, so the real limit depends on how many instances run.
- Requests with no Origin header pass the origin check.
- The list shows 50 threads, waiting ones first. If a waiting marker is lost, the thread is listed by recency only, and an older one is then reachable by its id. If a summary write fails twice, that thread is missing from the list until it is opened, and opening it by id repairs that.
- Summaries, recency markers and claims are never deleted, so the keys grow without bound. Only the 50 most recently updated and the waiting ones are read.
- A claim is a time-limited lock, not a transaction. A run that takes longer than 60 seconds before its claim is released could be joined by a second run. Runs are limited to 25 seconds, so this needs a stall in the store.
- A run that fails is marked failed. Retry continues it from the checkpoint, unless it failed before any step was saved. A retry after a platform stop mid-call may repeat that call and bill it twice.
- A failed thread, reopened later, shows the steps that finished. The failing step's message appears only in the live run.
- A run the platform stops before it pauses or ends is not listed in the threads.
- Closing the page does not stop a run. The run finishes on the server, and the provider may bill it.
- Every call sets `require_parameters`, so OpenRouter routes it only to providers that accept every parameter in the request.
- The served model is the one the provider names in its reply. If the reply names none, the trace shows the requested model.
- The state keys are `classification`, `triage` and `replyDraft`, because LangGraph does not allow a node and a state key to share a name.
- No test calls OpenRouter, GitHub or Netlify Blobs. The live GitHub fetch and the model calls were run by hand on 2026-10-09 and are not part of the test suite.
