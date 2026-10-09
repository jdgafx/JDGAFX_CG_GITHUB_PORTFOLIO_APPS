# GraphGate

GraphGate is a refund agent for support tickets, built with LangGraph.js. A ticket comes in. The graph reads the order id and the issue, checks a fixed refund policy against sample orders, and drafts a decision. Small refunds (up to $50) are approved automatically. Anything larger, or any case the policy cannot decide, pauses the run. A person then approves, edits the amount, or rejects it. The run resumes and writes the customer reply.

The graph needs LangGraph because the pause has to survive a reload. The run stops at an `interrupt()` call and writes its state to a checkpoint in Netlify Blobs. A visitor can close the page, come back, see the thread listed as waiting, and resume it from that checkpoint. A plain chain cannot stop mid-run and continue later from stored state.

What this showcases: a graph that pauses for a human with `interrupt()`, saves its checkpoint, and resumes from it after a reload.

## The graph

```text
START -> intake -> policy -> decide --requiresHuman--> review -> reply -> END
                               |                         ^
                               +----otherwise------------+
```

- **intake** (model): reads the ticket into JSON facts: order id, issue type, requested amount.
- **policy** (tool, no model): applies the refund rules to the sample order table.
- **decide** (model): writes the rationale. Its action and amount come from the policy, not the model.
- **review** (human): calls `interrupt({ proposal, policy, ... })`. The run stops here until resumed with `approve`, `edit` or `reject`.
- **reply** (model): writes the customer email for the final outcome. After a person decides, the model gets the final outcome and the reviewer note, not the earlier rationale. A draft that says an approval is still pending is replaced with fixed wording, and the trace says so.

Conditional edge from **decide**: `requiresHuman` goes to review when the policy amount is over $50 or the case is unclear. `otherwise` goes straight to reply. The graph has no cycles. The only pause is the review interrupt.

Policy rules, applied in order: no matching order or an unrecognised issue is unclear (a person decides). A delivery more than 30 days ago, measured in elapsed time, or a final sale item, is not eligible. A duplicate charge refunds the extra money charged. A defective item on a one-item order refunds its price. Amounts above $50 need a person.

## Models

| Node | Model | List price (USD per 1M in / out) | Why |
| --- | --- | --- | --- |
| intake | `xiaomi/mimo-v2.6-flash` | $0.14 / $0.28 | Reads the ticket into JSON facts |
| decide | `~anthropic/claude-haiku-latest` | $0.10 / $0.50 | Short rationale in plain language |
| reply | `~anthropic/claude-haiku-latest` | $0.10 / $0.50 | Customer email in plain language |

Output caps are 300, 500 and 600 tokens. Usage accounting is on for every call. The intake reply is read as its first complete JSON object, so a code fence or prose around it still works. The UI shows the cost OpenRouter reports. When it reports none, the UI estimates from the list prices and labels the figure "estimated".

## What the UI shows

- **Support ticket**: two sample tickets, one that needs approval and one that is approved automatically. Each one loads into the ticket text.
- **Graph**: the five steps as the run walks them. The two decide edges are labelled "needs a human" (`requiresHuman` in the code) and "auto-approve" (`otherwise`). The path the run took is highlighted, and review shows as paused while the run waits.
- **Approval card**: the proposed outcome, the policy reason, the order total, what the customer asked for, and Approve refund, Edit amount and Reject. An edited amount may not exceed the order total. This is the intended rule.
- **Run trace**: each step in the order it ran, with its time in milliseconds, served model, tokens and cost.
- **Readout**: under the graph, the run time (the sum of the steps that ran), tokens, cost and served models. A value the provider did not report reads "not reported".
- **Customer reply**: the subject and body, and whether a person or the policy decided.
- **Threads**: the saved threads, newest first. Open a waiting thread to approve it after a reload.

## Architecture

Browser, then Netlify Functions, then OpenRouter and Netlify Blobs.

- `POST /api/start` takes `{ ticket }` (10 to 2,000 characters). It streams server-sent frames: `thread`, then `node_start`, `node_end`, `edge`, then `interrupt` or `result`, then `[DONE]`.
- `POST /api/resume` takes `{ threadId, decision }`. It streams the rest of the run from the checkpoint. A thread that is not waiting gets 409.
- `GET /api/threads` returns the thread index and where checkpoints are kept.
- `GET /api/thread?id=` returns one thread's status, full ticket text, pending proposal and result.
- Checkpoints use the `graphgate-checkpoints` Blobs store, with keys under `thread/<id>/`. The thread index is one document at `threads/index`. It keeps 50 threads, and a thread awaiting approval is never dropped.
- The checkpoint saver imports its base class, `WRITES_IDX_MAP` and checkpoint types from `@langchain/langgraph-checkpoint`. That package is therefore a direct dependency, pinned to the version `@langchain/langgraph` already uses.
- The OpenRouter key is read only on the server. A missing key returns 503 before any model call.
- Requests from unknown origins get 403, and wrong methods get 405. A request with no Origin header passes. Bodies over 16 KB get 413. Each client address gets 20 starts or resumes a minute.
- One request has a 25-second budget, because Netlify closes these functions at about 30 seconds in practice. Each model call has 12 seconds, and each checkpoint or index call has 8 seconds. Every call also stops when the budget ends. A stalled call, or a run that uses the whole budget, fails the run with a plain message, marks the thread failed, and the stream still ends with `[DONE]`. The final index write has its own 8-second limit and is not counted in the budget.
- Reads of the thread list and of one thread use the 8-second limit only.
- A failure is sent as an `error` frame with plain-language text. The trace marks the step that failed.

## Run locally

```bash
npm ci
npm run dev          # UI only; running a ticket needs the functions
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

Live URL: https://jdgafx-app-12-langgraph-approval-flow.netlify.app

## Known limits

- The sample orders are fictional. Their dates are counted back from the current day.
- The 30-day window and the final-sale rule apply to duplicate charges too. A real shop might treat billing errors differently.
- Intake reads only order ids of the form ORD-1234 and three issue types. Anything else goes to a person.
- The page has no sign-in. Anyone with the URL can run tickets and approve refunds on the sample data.
- The rate limit and the resume guard count per function instance, so the real limits depend on how many instances run.
- Requests with no Origin header pass the origin check.
- The thread index is read, changed and written as one document. Two writes at the same moment can drop a row. Checkpoints are not affected.
- If the index write fails after a pause, the paused thread is not listed, so its approval cannot be reached from the page.
- If the index write fails after a resume completes, the thread stays listed as awaiting approval with no proposal. Resuming it then answers 409.
- Waiting threads are never dropped, so the index can grow past 50 when many approvals are left waiting.
- Two approvals for one thread are refused only inside one instance. Across instances they could both run.
- A run that fails after approval is marked failed and cannot be resumed.
- A failed thread, reopened later, shows the steps that finished. The failing step's message appears only in the live run.
- A run the platform stops before it pauses or ends is not listed in the threads.
- Closing the page does not stop a run. The run finishes on the server, and the provider may bill it.
- The intake reply is read as its first JSON object. A reply with no object sends the ticket to a person. Whether the flash model returns JSON on the live site is checked only in the live run.
- The Haiku calls set `require_parameters`, so OpenRouter routes them only to providers that accept every parameter in the request.
- The model's reasoning is off for every call.
- The served model is the one the provider names in its reply. If the reply names none, the trace shows the requested model.
- The state keys are `policyResult` and `replyEmail`, because LangGraph does not allow a node and a state key to share a name.
- No test calls OpenRouter or Netlify Blobs. The live site was not run as part of this build.
