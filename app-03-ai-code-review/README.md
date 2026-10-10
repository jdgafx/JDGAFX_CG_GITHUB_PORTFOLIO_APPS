# CodeLens AI

CodeLens AI reviews code and checks its own review. You paste a source file, load one from public GitHub, or paste a link to a public GitHub pull request. A first model pass writes comments with line numbers. A second model pass then reads every comment against the actual code and decides to keep it, move it to the line it is really about, or drop it, with a one-line reason that quotes the code. Deterministic checks back both passes up. The page shows what was kept, moved and dropped, and why. The run figures show the time, tokens and cost of both passes, and the run trace shows each stage with its time.

What this showcases: a verified review. A model's comment is only shown as checked when the code it quotes is really on the line it names.

Live site: https://jdgafx-app-03-ai-code-review.netlify.app

## Verified review

The pipeline for one run, in order. The trace shows each stage with its status, start, time and detail.

1. **Check request**: rate limit, key present, body at most 256 KiB, then either `code` (non-blank, at most 50,000 characters, plus a short `language`) or a pull request (`mode: "pr"` and its files).
2. **Build prompt**: numbers every line. A file is numbered as it is. A pull request becomes one numbered diff: a header line per file, the hunk headers, and every added (`+`), removed (`-`) and context line. The comment budget is one per 15 lines (file) or per 15 changed lines (pull request), at least 5, at most 15. Output cap 4,096 tokens, reasoning off.
3. **Pass 1: review**: one chat completion that writes the comments as JSON: line, the exact quoted code, severity, message, suggestion and an `issue` flag.
4. **Parse reply**: reads the JSON. A code fence, prose around it, or a bare array of comments is tolerated.
5. **Checks** (no model): every comment ends up kept for pass 2 or dropped with a reason.
   - A line outside the numbered lines, or a comment the model marked `issue: false`, is dropped.
   - A comment whose message ends by calling the code fine ("so this is safe", "kept only for compatibility") without proposing a change is dropped.
   - A comment whose suggestion leaves the code as it is ("Leave as-is", "No change needed", "Keep it in place") is dropped.
   - A comment that quotes code must find it on, or within 10 lines of, its line, or it moves to that line; a quote found nowhere drops it. If the line holds none of the code names in the message (a hash such as SHA-1 counts as `sha1`) and exactly one line within 20 does, the comment moves there.
   - In a pull request a comment may only sit on an added or removed line. A comment on context, a file header or a hunk header moves to the changed line that holds its quote, or is dropped.
   - A warning or critical comment whose own message says "not a crash", "safe today" or "harmless" is lowered to info, and says so.
6. **Pass 2: verify, two reads side by side.** Both get the numbered code and, for each surviving comment, its scope (the whole function or class that holds the line, found by braces or indentation, cut around the line when it is very long) and the definitions of the functions the comment names (so a claim about `open()` is read against `def open`). Read 1 answers `keep`, `move` (to a line), `drop` or `unsure` for each comment, copying from the file the code it rests on (`evidence`, on the named line) and the code that makes the claim true (`support`, anywhere in the file). It is told to trace each claim (the assignment that makes a value None, the path by which a number reaches a line), to drop false claims, claims that change nothing and objections to what the code must do, and to answer `unsure` when the claim depends on something outside the file (another file, a library's internals, a version). Read 2 is an adversary with a different prompt: for each comment it looks for code that breaks the claim (an earlier branch that handles the case, a guard, a definition that does what the comment says is missing) and answers `refuted`, `stands` or `unsure`, quoting code.
7. **Re-validate** (no model): a comment is kept or moved only when all of these hold.
   - Read 1 kept or moved it, and its `evidence` is on the named line (one line either side is allowed for a statement that spans lines). The line must exist, be able to carry a comment, and be within 25 lines of where the comment sat.
   - Its `support` is code that really is in the file. No support, or support that is not there, leaves the comment not confirmed, however real the cited line is.
   - Read 2 quoted code that is in the file and found nothing that breaks the claim. Found code, an unsure adversary, an invented quote or a read that did not finish leaves it not confirmed, with both opinions in the reason.
   - A move keeps the comment's subject: it never leaves the line that declares a name the message is about (the live `path := req.URL.Path` shadowing comment), never crosses from an added line to a removed one in a pull request, and a move away from the line where the first pass's own quote sits is refused (live: mux `walk`, 391 to the signature).
   - The reason and the line must agree: a reason that points at the line holding the code the message names (live: SHA-1 comment on line 200, reason "cnonce at line 205"), or a signature comment whose reason points only at body lines, is not confirmed.
   - A first-read `drop` needs its evidence in the code and stands on its own, because dropped comments are listed with their reason. An `unsure` answer is shown as not confirmed with what the claim rests on.
   The badge on a kept comment says "Evidence checked, nothing found against it": that is what was checked, not a proof that the claim is true.

Every first-pass comment appears exactly once in the result: kept, moved, dropped (by the second pass or by the checks) or not confirmed. The page shows a ledger bar with one segment per first-pass comment and the count written under each group, then the comments to act on. Each card shows the cited code with the second pass's quote marked inside the line, then one verdict line (a badge and the reason), then the code that shows the claim, the message and the suggestion. Comments the reads could not confirm are listed apart in a closed "Not confirmed" list (open when nothing was confirmed or a read failed). "Show context" opens the four lines either side. In file mode "Show in editor" moves focus to that line in the editor with a note and a "Back to comment" button that returns the page to where it was, and every commented line in the editor gutter is marked and links back to its comment. A "Dropped comments" list opens on demand with the code, who dropped each comment and why. If a second-pass read cannot finish, the review still returns, every surviving comment is marked not confirmed, and the badge says "Partly checked".

## Pull request review

Paste a public pull request link (`https://github.com/owner/repo/pull/123`, `owner/repo#123` or `owner/repo/pull/123`). The browser fetches the pull request and its file list from `api.github.com` (`/repos/{owner}/{repo}/pulls/{n}` and `/pulls/{n}/files?per_page=100`; the CSP `connect-src` lists that host). Nothing is fetched by the server.

- The second pass sees diff positions, so its reasons are rewritten to `file:line` before they are shown, and each `file:line` links to that line on GitHub at the pull request's head commit (the base commit for a removed line).
- Only changed lines are reviewed. Context lines are shown to the reviewer so it can understand a change, but a comment can only sit on an added or removed line. Each comment is anchored to the file and line of the diff, on the new side for an added line and the old side for a removed one.
- Limits are shown, never applied silently. The diff of all selected files may be at most 50,000 characters (the same limit as pasted code). Files are included whole or not at all. By default files are selected in GitHub's order while each still fits; every other file shows why it is out: no text patch (binary or very large diffs have none), lockfile or minified output, larger than the whole limit, or not selected. A file that would pass the limit cannot be ticked until another is unticked. The page shows "N of M files, K changed lines, X of 50,000 characters", and the server answers with the counts it read.
- GitHub lists a pull request's files in pages of 100. The page loads the first page and says so when the pull request changes more files than that.
- Loading a pull request costs 2 of the 60 anonymous GitHub requests an hour. A spent quota is reported with its reset time.

Three merged pull requests are offered as one-click starts: `psf/requests#6963`, `gorilla/mux#731` and `gorilla/mux#691`.

## Load a file from GitHub

Enter a public file as a link (`https://github.com/owner/repo/blob/ref/path`, a `raw.githubusercontent.com` link, or `owner/repo/path` for the default branch). The browser fetches it from `api.github.com/repos/{owner}/{repo}/contents/{path}?ref=`. The language is set from the file name. Three real files are offered: `psf/requests` `auth.py`, `gorilla/mux` `mux.go` and `reduxjs/redux` `createStore.ts`, each at a release tag.

A file over 50,000 characters, a binary or empty file and a folder are refused with a message; a file is never cut. The text is loaded unchanged except for a dropped byte order mark, LF line breaks and a dropped final line break, so the line numbers match GitHub. A branch name that contains `/` cannot be told apart from a folder in a link; link to a tag or a commit instead.

## Time budget

One function invocation must finish inside the platform's cut-off, so the two model calls share one 25 s deadline (`netlify/shared/budget.ts`, tested in `tests/unit/budget.test.ts`). Healthy latencies were measured live on `anthropic/claude-haiku-5.5` over 39 complete runs (about 120 model calls) on 2026-10-09:

| Call | p50 | p95 | Per-call limit (1.5 x p95) |
|---|---|---|---|
| Pass 1: review | 9.3 s | 11.6 s | 17.4 s |
| Pass 2: each of the two reads (side by side) | 6.3 s | 9.4 s | 14.1 s |
| Both passes together | 17.6 s | 24.3 s (a 1,179-line file; typical files 15 to 21 s) | 25 s (the run) |

- A call that passes its limit is a provider hang. It is retried once, after a timeout or a lost connection only, and only when what is left of the run could hold a healthy call (and, for pass 1, a healthy pass 2). The trace shows "Retried once after ...", or "Not retried: N s left". 4xx, 429 and 5xx are never retried.
- An empty reply, a reply cut at the token cap and a reply that is not readable JSON (a pass 1 review, or a pass 2 list of verdicts) are also retried once when the budget allows.
- After a full-length pass 1 hang (17.4 s) there is not enough left for a retry plus pass 2, so the run answers 504 with its trace.
- The two reads of pass 2 run at the same time and each has its own limit and its own single retry. If a read fails or hangs, the run still answers with the first-pass comments marked not confirmed.
- The browser retries once when the connection drops within 12 s, or when a reply ends before its JSON does (the earlier verifier saw one such call as `ERR_ABORTED` with an empty trace). It never retries a timeout or an HTTP answer, and a failed run without a server trace shows a trace row that says what the browser saw.
- The browser gives up after 45 s.

## Architecture

- **Browser**: React and Vite in `src/`. `lib/api.ts` posts `{ code, language }` or `{ mode: "pr", files }` to `/api/ai` and checks the shape of the reply once. `lib/github.ts` and `lib/pullrequest.ts` parse links and read GitHub replies. `lib/verdicts.ts` holds the counting and wording of verdicts. Model prose is rendered through `lib/markdown.ts` as elements, never as raw markers or HTML.
- **Server**: the Netlify Function `netlify/functions/ai.ts` (request checks, rate limit, responses). The pipeline sits in `netlify/shared/`: `pipeline.ts` (stages, retry), `budget.ts`, `model.ts` (one call with its own limit), `review.ts` (prompts, parsing, checks), `anchor.ts` (where a comment sits), `verify.ts` (second-pass prompt, verdicts, re-validation), `diff.ts` (patch parsing, file selection), `trace.ts`, `provider.ts`, `deadline.ts`.
- **Provider**: OpenRouter chat completions. The model is one constant, the OpenRouter alias `~anthropic/claude-haiku-latest` (the newest Claude Haiku), in `netlify/shared/provider.ts`. The page shows the model OpenRouter answered with (currently `anthropic/claude-haiku-5.5`), never the alias. No temperature is sent; reasoning is off. The client cannot choose the model.
- **Key**: `OPENROUTER_API_KEY` is read only on the server.
- **Request checks**: POST only (405); the Origin must be on the allowlist (403); the body must be JSON (400) and at most 256 KiB (413); 20 requests a minute per address (429).
- **Errors**: every failure returns `{ success: false, error }` in plain language with the trace of the stages that ran. Provider bodies, keys and stack traces never reach the browser.
- **Design**: the shared design system v3.3 (`src/styles/tokens.css` and `components.css`, copied unchanged), `data-app="3"`. Only what is local is in `src/styles/app.css`.

## Run locally

```bash
npm ci
npm run dev        # UI only: reviews show an error until the functions run
npx netlify dev    # UI and functions together, on port 8888
```

- `OPENROUTER_API_KEY` is required for reviews.
- `ALLOWED_ORIGINS` is optional: a comma-separated list of origins allowed to call the function. The default is the live site and `localhost` on ports 8888 and 5173.

```bash
npm test           # no test calls a provider or GitHub
npm run lint
npm run typecheck
npm run build
```

The tests use data recorded from the live services: the patch of `psf/requests#6963`, lines of `gorilla/mux` `mux.go` and `psf/requests` `auth.py`, suggestions and messages the live model wrote for them, and the shapes of GitHub's replies.

## Known limits

- **Every pass is the same small model.** The second pass is built to distrust the first: scope and the definitions of called functions, evidence plus supporting code, an adversarial read, and checks that need no model (a claim about how an imported library behaves, where a link points, a version, the process environment, a failure with no named path, a None claim with no None in its support, or a "never closed" claim when the scope closes it, is never confirmed; a claim about the caller's object whose variable was assigned from an imported or unknown function within three assignments is never confirmed; a warning or error is confirmed only when its evidence and support are inside the scope, the assignment lines and the definitions the reads were shown; a comment never moves to another file). In 13 live runs on the final code (150 first-pass comments on mux.go, auth.py, createStore.ts, express `response.js`, requests `adapters.py`, click `utils.py` and five pull requests) 31 comments were confirmed, 45 were left not confirmed and 74 dropped. Reading every confirmed comment I find 1 clearly wrong (requests#6963, an unset `$HOME` claim, which a check added afterwards now refuses; not re-measured live) and about 6 weak or overstated, mostly info-level. Reading the 45 not confirmed I judge about 18 of them correct findings (for example a real click#2800 regression, dead `entdig`, a redundant `qop` test, a doc typo with no quotable code). The checks buy precision with recall. A dropped comment is sometimes a real finding too; the dropped list exists so you can see and judge those calls.
- A confirmed verdict means: the quoted code is on the line it names, the code the second pass gave as support is in the file, and an adversarial read looking for code that breaks the claim found none. It does not mean the claim is true. A false claim can still be backed by real lines (the model can quote the right function and still miss the branch that makes the claim false).
- Pull request review gives the reads the diff and its unchanged context lines, not the whole new-side file: fetching each file at the head commit from `api.github.com` would cost one of the 60 anonymous requests an hour per file, so a claim that depends on code outside the diff is not confirmed.
- Results vary between runs of the same file: counts, wording and which comments survive differ every time.
- The checks use word patterns for "leave as-is" and "this is fine" verdicts and names for moving comments. They catch the phrasings seen so far, not every phrasing, and a move by name can land one or two lines from the best line.
- A pull request review reads at most 50,000 characters of diff, whole files only, from the first 100 files GitHub lists, and cannot see code outside the diff. A claim about code outside the diff cannot be checked and is dropped by the second pass when it says so.
- A very large diff can take a full-length pass 1 (about 10 to 12 s), leaving no time to retry an unreadable reply. The run then answers with an error and its trace.
- The rate limit counts requests per warm function instance, so the effective limit depends on how many run.
- Stop cancels the browser request. The server keeps running until it finishes or its deadline, and the provider may still bill the calls.
- A run costs about $0.005 to $0.012 (the review and two reads) on a 600-line file, and up to three more calls when retries happen.
- The function's platform time limit is not set in this repository; the 25 s run deadline is set in code.
- Reviews are not saved. Reloading the page clears the result.
