# GraphGate

GraphGate triages live public GitHub issues with a LangGraph.js graph. The visitor picks a repository and one of its newest open issues. The graph classifies the issue, applies fixed rules, and either triages it alone or pauses for a maintainer. The maintainer approves, edits the labels and priority, or rejects. The run resumes and drafts the comment a maintainer could post.

Draft only: nothing is posted to GitHub. No label, priority or comment is applied there. The page and this README say so wherever a draft appears.

The graph needs LangGraph because the pause has to survive a reload. The run stops at an `interrupt()` call and writes its state to a checkpoint in Netlify Blobs. A visitor can close the page, come back, see the thread listed as waiting, and resume it from that checkpoint. A plain chain cannot stop mid-run and continue later from stored state.

What this showcases: a graph that pauses for a human with `interrupt()`, saves its checkpoint, and resumes from it after a reload.

## Data

The issues are real and are fetched live, in the visitor's browser, from `https://api.github.com/repos/{owner}/{repo}/issues`. GitHub allows cross-origin reads and gives each anonymous visitor 60 requests an hour. Netlify functions share addresses, so the server never calls GitHub. A rate limit shows the reset time from GitHub's `X-RateLimit-Reset` header.

- Five well-known repos are one click each: `react/react` (formerly facebook/react), `vitejs/vite`, `microsoft/vscode`, `denoland/deno` and `langchain-ai/langgraphjs`. Any other public repo can be typed as `owner/name` or pasted as a github.com link.
- The list shows the 25 newest open issues. Pull requests share the endpoint and are dropped. Each row shows the number, title, labels, age and comment count.
- The page sends the chosen issue to the server: repo, number, title, body (cut to 6,000 characters), labels, author association, created date, link and comment count.

The issue text reaches the server from the visitor's browser, so it is unverified. The server checks every field at the boundary and treats the text as untrusted data.

## The graph

```text
START -> classify -> decide --requiresHuman--> review -> reply -> END
                        |                         ^
                        +-------otherwise---------+
```

- **classify** (model): reads the issue into a fixed shape: type (bug, feature, question, docs, other), area, severity, flags for unclear, likely duplicate and possible security report, a confidence from 0 to 1, and a one-sentence summary.
- **decide** (rules, no model): proposes labels and a priority, and decides whether a maintainer must look. The same issue and classification always give the same verdict.
- **review** (human): calls `interrupt({ issue, classification, triage })`. The run stops here until resumed with `approve`, `edit` or `reject`.
- **reply** (model): drafts the maintainer comment for the final outcome. The model is told the outcome is final, so a draft that calls it pending is replaced by fixed wording, and the trace says so.

The conditional edge from **decide** goes to review when any of these holds, and straight to reply otherwise:

- the issue may be a security report, by the classifier or by a keyword check on the issue text (security, vulnerability, CVE, XSS, RCE, SSRF, injection, a leaked token or key);
- the issue text is aimed at an AI assistant: the classifier says so and quotes the words, and the quote is found in the issue text, or a short list of high-precision patterns finds such words ("Assistant, ...", "ignore your instructions", "in your reply ..."). The reason on the card quotes what was found;
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

## What the UI shows

- **Repository**: the well-known repos and a field for any other public repo.
- **Open issues**: the newest open issues of that repo, each with a Triage button.
- **Graph**: the four steps as the run walks them. The two decide edges are labelled "needs a maintainer" (`requiresHuman` in the code) and "auto-triage" (`otherwise`). The path the run took is highlighted. While the run waits, the review box turns amber with a pause mark and the words "Paused for a maintainer". On a narrow screen the graph scrolls sideways.
- **Approval card**: why the graph paused, the classification, the proposed labels and priority, and Approve, Edit and Reject. Edit shows label checkboxes and a priority select. A note is optional.
- **Triage card**: the final labels and priority, how the decision was reached, the drafted comment, and the line "Draft only. Nothing is posted to GitHub".
- **Run trace** and **readout**: each step with its time, served model, tokens and cost. A value the provider did not report reads "not reported".
- **Retry card**: shown on a failed thread. It continues from the checkpoint and runs only the step that failed.
- **Threads**: the saved threads, newest first. Open a waiting thread to review it after a reload: the page scrolls to its card and moves focus there.

## Architecture

Browser, then Netlify Functions, then OpenRouter and Netlify Blobs. GitHub is called by the browser only.

- `POST /api/start` takes `{ issue }`. It streams server-sent frames: `thread`, then `node_start`, `node_end`, `edge`, then `interrupt` or `result`, then `[DONE]`. A bad issue gets 400 before any model call.
- `POST /api/resume` takes `{ threadId, decision }`. It streams the rest of the run from the checkpoint. A thread that is not waiting gets 409. The classify call is not repeated: the resumed run reads it from the checkpoint.
- `POST /api/retry` takes `{ threadId }`. It continues a failed thread from its last checkpoint and streams like resume. The classification and a maintainer's answer are read from the checkpoint and not run again. A thread that did not fail, or has no saved step, gets 409.
- `GET /api/threads` returns the thread index and where checkpoints are kept.
- `GET /api/thread?id=` returns one thread's status, issue, pending proposal and result.
- Validation of the issue: `repo` is `owner/name`; `number` is a positive integer; the title is 1 to 300 characters; the body is text of at most 6,000 characters; there are at most 30 labels of 50 characters; `authorAssociation` is one of GitHub's values; `createdAt` is a UTC ISO time; and the link must equal `https://github.com/{repo}/issues/{number}` exactly. Control characters are removed from text.
- Checkpoints use the `graphgate-checkpoints` Blobs store, with keys under `thread/<id>/`. The thread index is one document at `threads/index`. It keeps 50 threads, and a thread awaiting a maintainer is never dropped.
- The checkpoint saver imports its base class, `WRITES_IDX_MAP` and checkpoint types from `@langchain/langgraph-checkpoint`. That package is therefore a direct dependency, pinned to the version `@langchain/langgraph` already uses.
- The OpenRouter key is read only on the server. A missing key returns 503 before any model call.
- Requests from unknown origins get 403, and wrong methods get 405. A request with no Origin header passes. Bodies over 32 KB get 413. Each client address gets 20 starts or resumes a minute.
- One request has a 25-second budget, because Netlify closes these functions at about 30 seconds in practice. Each model call has 8 seconds, with one automatic retry when it hangs or loses its connection and the budget has room. Each checkpoint or index call has 8 seconds. Every call also stops when the budget ends. A stalled call, or a run that uses the whole budget, fails the run with a plain message, marks the thread failed, and the stream still ends with `[DONE]`. The final index write has its own 8-second limit and is not counted in the budget.
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
- `NETLIFY_BLOBS_CONTEXT`: set by Netlify. Without it the server keeps checkpoints in memory and the page shows a notice.

Checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

The tests mock the model and the store. They cover the graph paths with a mocked model (auto-triage, pause then approve, edit, reject, and resume from a fresh checkpointer over the same store), the retry of a failed thread, the call and budget deadlines (including a reply whose body never finishes), the rules, the boundary validation of the issue and of the decision, the parsing of a recorded GitHub response, the draft guard, and the thread index. The recorded GitHub response exists only in the tests. The app fetches live.

Live URL: https://jdgafx-app-12-langgraph-approval-flow.netlify.app

## Known limits

- The classification is a model's reading of text a stranger wrote. A crafted issue may push the model to call itself confident. The rules catch security wording and text aimed at an assistant, and the draft is checked, but a clear-looking issue can still be triaged without a maintainer. The result is a draft that nothing posts.
- The page has no sign-in. Anyone with the URL can run issues and answer reviews.
- GitHub's anonymous limit is 60 requests an hour per visitor address. Loading a repo costs one request.
- Pull requests are dropped after the fetch, so a repo with many open pull requests lists fewer than 25 issues.
- The issue text is cut to 6,000 characters before it is sent. The reply call sees the first 1,500.
- Threads saved by the earlier refund version of this app have a different shape. The thread list skips them, so they cannot be opened or resumed. The next write to the index drops them.
- The rate limit and the resume guard count per function instance, so the real limits depend on how many instances run.
- Requests with no Origin header pass the origin check.
- The thread index is read, changed and written as one document. Two writes at the same moment can drop a row. Checkpoints are not affected.
- If the index write fails after a pause, the paused thread is not listed, so its review cannot be reached from the page.
- If the index write fails after a resume completes, the thread stays listed as awaiting a maintainer with no proposal. Resuming it then answers 409.
- Waiting threads are never dropped, so the index can grow past 50 when many reviews are left waiting.
- Two answers for one thread are refused only inside one instance. Across instances they could both run.
- A run that fails is marked failed. Retry continues it from the checkpoint, unless it failed before any step was saved. A retry after a platform stop mid-call may repeat that call and bill it twice.
- A failed thread, reopened later, shows the steps that finished. The failing step's message appears only in the live run.
- A run the platform stops before it pauses or ends is not listed in the threads.
- Closing the page does not stop a run. The run finishes on the server, and the provider may bill it.
- Every call sets `require_parameters`, so OpenRouter routes it only to providers that accept every parameter in the request.
- The served model is the one the provider names in its reply. If the reply names none, the trace shows the requested model.
- The state keys are `classification`, `triage` and `replyDraft`, because LangGraph does not allow a node and a state key to share a name.
- No test calls OpenRouter, GitHub or Netlify Blobs. The live GitHub fetch and the model calls were run by hand on 2026-10-09 and are not part of the test suite.
