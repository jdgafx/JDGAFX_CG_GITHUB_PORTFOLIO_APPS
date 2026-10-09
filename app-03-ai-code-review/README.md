# CodeLens AI

CodeLens AI reviews a source file. You paste code or load a public file from GitHub, pick its language and run a review. The app returns comments, each with a line number, a severity, a message and a suggested change. Select Line to jump to that line in the editor. The run figures show how long the review took, and the tokens and cost the provider reported. The run trace lists each stage of the review in order.

What this showcases: a structured JSON review whose line citations are validated against the real file before anything is shown.

Severity levels are `critical`, `warning` and `info`. Critical covers security holes, crashes and data loss risks. Warning covers likely bugs, performance problems and code smells. Info covers style, best practice and refactoring notes.

## Load from GitHub

The visitor enters a public file as a link (`https://github.com/owner/repo/blob/ref/path`, a `raw.githubusercontent.com` link, or `owner/repo/path` for the default branch). The browser fetches it from `api.github.com/repos/{owner}/{repo}/contents/{path}?ref=`, which allows cross-origin calls without a key. The editor is filled with the file, the language is set from the file extension, and a source card shows the repository, branch or tag, path, size, line count and a link to the file on GitHub.

- Three suggested files are offered with one click: `psf/requests` `auth.py` (Python), `gorilla/mux` `mux.go` (Go) and `reduxjs/redux` `createStore.ts` (TypeScript). They point at release tags and are fetched live each time. Nothing is stored in the app.
- Only `github.com`, `www.github.com` and `raw.githubusercontent.com` links are accepted. Folder links and other hosts are refused with a message.
- A file over the 50,000 character limit, a binary file, an empty file and a folder are refused with a message that gives the size and the limit. A file is never cut.
- The text is loaded unchanged except for three things: a byte order mark is dropped, line breaks become LF, and the final line break is dropped. The editor then shows the same line numbers as GitHub, and a review cites the same lines. If the visitor edits the text, the card says so.
- GitHub allows 60 anonymous requests an hour from one address. When that is used up the page says so and gives the reset time from the `X-RateLimit-Reset` header. Every fetch times out after 15 seconds.
- A branch name that contains `/` cannot be told apart from a folder in a link. Link to a tag or a commit instead.

## Pipeline

A review runs these stages in this order. The trace shows each one with its status, time and detail.

1. **Check request**: applies the rate limit, confirms the provider key is set, reads the body (256 KiB at most), requires non-blank `code` of at most 50,000 characters, and reduces `language` to a short name or `code`.
2. **Build prompt**: numbers every line and sets the comment budget. The budget is one comment per 15 lines, at least 5, at most 15, and never more than the file has lines. The output cap is 4,096 tokens and reasoning is off.
3. **Model call**: one chat completion with usage reporting turned on.
4. **Retry**: runs only when the first reply is empty or was cut short at the token cap. It runs at most once. Otherwise the trace marks it skipped.
5. **Parse reply**: reads the JSON review, which must hold a `comments` array. Code fences and surrounding prose are tolerated. Anything else is an error.
6. **Validate comments**: keeps comments whose line is a whole number from 1 to the line count, whose severity is `critical`, `warning` or `info`, and whose message and suggestion are not blank. Text is cut at 600 characters, and no more than the budget is kept.

If the browser cannot reach the server, the trace shows a single step, **Send request**, marked failed.

The review panel shows each comment beside the line it cites, with that line's text. A row of cells shows the comment budget for the file: one cell per comment the reviewer could return, filled for each comment it did return. The run figures show total latency, prompt, completion and total tokens, cost in USD, and the served model named in the provider's reply. The run trace lists the stages, each with its status and time. A value the provider did not report shows as "not reported". The app never estimates a cost.

## Architecture

- **Browser**: a React and Vite app in `src/`. It posts `{ code, language }` to `/api/ai`. It checks the shape of the reply once, in `src/lib/api.ts`, and shows a plain error for a reply that does not match. The GitHub loader is `src/lib/github.ts` (link parsing, extension to language, reply decoding) and `src/components/GitHubLoader.tsx`.
- **Server**: the Netlify Function `netlify/functions/ai.ts`, served at `/api/ai`. Shared code sits in `netlify/shared/`. `provider.ts` makes the chat call, and `review.ts` builds the prompt and parses and checks the reply.
- **Provider**: OpenRouter chat completions. The model is one constant, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned, in `netlify/shared/provider.ts`. There is no model picker, and a model field sent by the client is ignored.
- **Key**: `OPENROUTER_API_KEY` is read only on the server. The browser never receives it.
- **Request checks**: the method must be POST (405). An Origin header must be on the allowlist (403). The body must be JSON (400) and no larger than 256 KiB (413). Each client address gets 20 requests a minute (429).
- **Timeouts**: the server gives the provider 25 seconds for the whole run. The first call and any retry share that deadline. The browser gives up after 45 seconds.
- **Errors**: every failure returns `{ success: false, error }` with plain-language text, and the trace marks the failed step. The page shows the error in an alert with a retry button. Provider bodies, keys and stack traces never reach the browser. The messages are:
  - Provider 401 or 402: "The AI provider rejected the key or is out of credit."
  - Provider 429: "Rate limited, try again in a minute."
  - Provider 5xx or timeout: "The AI provider did not answer in time."
  - Browser cannot reach the server: "Could not reach the server. Check your connection and try again."

## Run locally

```bash
npm ci
npm run dev        # UI only: reviews show an error until the functions run
npx netlify dev    # UI and functions together, on port 8888
```

Environment variable names:

- `OPENROUTER_API_KEY` is required for reviews. Set it in your shell or in the Netlify site environment.
- `ALLOWED_ORIGINS` is optional. It is a comma-separated list of origins allowed to call the function. The default is the live site and `localhost` on ports 8888 and 5173.

Checks:

```bash
npm test           # unit and server smoke tests; no test calls a provider or GitHub
npm run lint
npm run typecheck
npm run build
```

Live site: https://jdgafx-app-03-ai-code-review.netlify.app

## Known limits

- The rate limit counts requests in each warm function instance, so the effective limit depends on how many instances run.
- Cancel stops the browser request. The server call keeps running until it finishes or times out, and the provider may still bill it.
- A retry sends the full prompt again, so one run can be billed twice.
- The prompt asks for at most one comment per line. The server does not enforce that rule.
- Findings come from a language model. A clean result is not a guarantee, and any finding can be wrong.
- The served model is the one the provider names in its reply. The request pins one model, so the two should match.
- No labelled evaluation set exists yet. The tests check code paths, not review quality.
- The live site was checked by hand. No automated test calls the provider.
- This repository sets the 25-second provider timeout in code. It does not set the platform's function time limit.
- Reviews are not saved. Reloading the page clears the result.
