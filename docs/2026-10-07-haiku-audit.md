# Portfolio audit: JDGAFX_CG_GITHUB_PORTFOLIO_APPS (2026-10-07)

**Scope:** the 10 apps, the portfolio page at https://jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/ (source: `docs/index.html`), and each app's live Netlify URL.

**Method:** every subagent ran as claude-haiku-5-5 at max effort. Six agents: five pairs of apps plus the portfolio page. The advisor agent was not used because no agent got stuck. Browser checks ran in headless Chromium through Playwright, one real task per app. Builds, screenshots and logs are in the session scratchpad, not the repo.

**Constraints kept:** no edits, commits, pushes, deploys, or Netlify/Supabase/GitHub setting changes. No secret values were printed or saved.

**Snapshot:** HEAD `8e23a17` (2026-08-23, "docs: publish truthful portfolio capability copy"). Working tree: 65 modified, 2 deleted, 36 untracked (103 items, all listed in Appendix A; none removed).

**Not for commit yet:** `docs/` is the GitHub Pages source. Committing this file would publish it at https://jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/2026-10-07-haiku-audit.md.

## 1. Bottom line

Six of the ten apps return a real answer on a live run. Two return a wrong or generic answer (app-05, app-07), and two fail on their first click: app-04's chat and app-06's default panel, both on the same dead `:free` model ID. Every live JS bundle is built from the uncommitted working tree, and the GitHub link that would auto-deploy from `main` is disconnected on all ten sites, so `main` does not describe what is running. The strongest apps by score are app-10 and app-08 (6 each). For agentic work specifically, lead with app-10, app-01, and app-02 (section 7). The portfolio page scores 5/10 and overstates several claims a technical reviewer can test.

Update after the model change (2026-10-07): nine apps now serve Haiku and pass their smoke checks, and app-04's chat works again. App-06 is the only app still failing its checks.

## 2. Status table

Score is the team's 1–10 for convincing a hiring manager hiring for agentic AI work. "Tree" is the uncommitted working tree. "Dist" is the repo's gitignored build from 2026-08-23, which is what Netlify serves. Every build passed at HEAD and in the working tree. No app has tests. This table reflects the audit before the 2026-10-07 model change; section 3 has the current state.

| App | Last commit · working tree | Live bundle | Live task | Pattern | Score |
| --- | --- | --- | --- | --- | --- |
| 01 AgentFlow | `f9ffa26` · 8 M, 2 ?? | = tree (JS and CSS) | REAL, 9.4 s | fixed four-stage pipeline | 5 |
| 02 DocMind | `0c9619d` · 8 M, 2 ?? | = tree (JS and CSS) | REAL, 4.1 s | retrieval + one call | 5 |
| 03 CodeLens | `f9ffa26` · 6 M, 2 ?? | = tree (JS and CSS) | REAL, 16.0 s | single call | 5 |
| 04 VoxAI | `f9ffa26` · 7 M, 3 ?? | = tree (JS and CSS) | FAILED, 502 | single call + speech | 3 |
| 05 DataPilot | `f9ffa26` · 5 M, 2 ?? | JS = tree and dist; CSS = HEAD | PARTIAL, 10.4 s | structured call + executor | 5 |
| 06 ModelArena | `f9ffa26` · 5 M, 2 ?? | = dist (CSS one rule off tree) | FAILED, 404 | parallel single calls | 4 |
| 07 ContentForge | `f9ffa26` · 4 M, 2 ?? | JS = tree; CSS two rules off | PARTIAL, 30.6 s | fixed five-step pipeline | 3 |
| 08 VisionLab | `f9ffa26` · 6 M, 2 ?? | = tree and dist | REAL, 4.2 s | single vision call | 6 |
| 09 InsightHub | `19514e7` · 6 M, 2 ?? | = dist (fresh build lacks the Supabase environment) | REAL in part, 14.6 s | single streamed call | 5 |
| 10 BrowseBot | `f9ffa26` · 9 M, 3 ??, 2 D | JS = tree and dist; CSS matches neither | REAL, 6.1 s | planner + browser executor | 6 |

Portfolio page: HTTP 200; 16 of 16 checkable links OK; last GitHub Pages deploy 2026-08-23 (`8e23a17`); score 5/10.

## 3. Deploy and repo state (verified today)

- **Auto-deploy is dead.** All 10 Netlify sites list the repo, branch `main`, and the correct base directory, but `installation_id` is `null` on all 10. The GitHub App link is broken, so pushes to `main` do not build or deploy. The 2026-08-02 memory note recorded the same fault.
- **Live code came from CLI uploads.** Each site's deploy history holds one deploy: `deploy_source=cli`, `commit_ref=null`, created 2026-08-23 between 06:02 and 12:32 UTC. Apps 01–03 carry the title "contrast repair canary".
- **The working tree is ahead of HEAD.** Nine apps have untracked `netlify/shared/` directories that HEAD does not have. HEAD functions for those apps do not import it, so the working-tree functions depend on code that is not committed. App-10 has an untracked `netlify/functions/execute.ts` and two deleted source files. App-04 is the exception: its shared `http.ts` is tracked.
- **Token hygiene.** `.git/config` and tracked files contain no GitHub token strings (checked by count only). The August memory note says a PAT that once sat in `.git/config` still needed rotating. Rotation cannot be verified from here.
- **OpenRouter key and credit.** The original production key authenticates, and free routes return HTTP 200, but a paid model returns HTTP 402, "Insufficient credits" (checked 2026-10-07). That key's account has about $260 of past spend and no paid credit left; add credit at https://openrouter.ai/settings/credits. On 2026-10-07 all ten sites were switched to the PME key (fingerprint `1c7fcb3269e4`), which belongs to a different account with paid credit. Nine apps (01–05, 07–10) now serve `anthropic/claude-haiku-5.5`, checked live on 2026-10-07. Seven apps (01, 02, 03, 05, 08, 09, 10) needed only `OPENROUTER_MODEL`. Apps 04 and 07 also needed a one-line change to their model allow-list, and were redeployed. App-06 is still pending: its panels map to fixed free model IDs, so which panel changes is a decision for you.- **Smoke suite.** `test-all-apps.sh` is modified and uncommitted. Run once against production on 2026-10-07: 49 of 54 checks passed, 5 failed, 0 skipped. The five failures are app-04's chat (2 checks), app-06's 404 stream (2), and app-07's Polish step (1), so the suite agrees with the audit on the three first-click failures. Its checks are shallow: they confirm that a step completes, not what it contains, so a moderation label would pass.
- **Graph.** Refreshed at handoff with a code-only extraction (`graphify update`, no LLM): 165 code files re-extracted; 1,974 nodes, 2,781 edges, 122 communities. The previous curated graph was backed up to `graphify-out/2026-10-07/`. Document and image semantics were not re-extracted, so this report, the README changes, and the docs since 2026-08-23 are not in the graph yet; that needs a semantic pass (`/graphify --update`) in an AI session.

## 4. Per-app findings

Live-versus-build checks compare bytes (`cmp`) of the live entry JS and CSS against two builds: the working tree and HEAD. The repo's gitignored `dist/` folders (built 2026-08-23) are the deploy artifacts; the live JS is byte-identical to each one.

### app-01 AgentFlow (multi-agent orchestrator): score 5/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 8 modified, 2 untracked. Live JS and CSS are byte-identical to the working-tree build. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200.
- **Live task:** REAL. "In two sentences, compare SSE and WebSockets for streaming LLM output." returned a four-stage report in 9.4 s, with token counts shown.
- **Agentic:** a fixed four-stage pipeline (Researcher → Analyst → Critic → Synthesizer), one LLM call per stage, one retry on failure. No planning, tools, memory, or evals. Trace yes; cost display no.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The copy promises "real-time SSE streaming" (root README line 24). The server streams from upstream, but emits each stage in one burst after it finishes: chunks are collected, then `chunks.forEach(onChunk)` runs (`netlify/functions/ai.ts`). Fix: reword now; stream live later. Effort S.
  2. The live site runs uncommitted code. `netlify/shared/` is untracked and imported at `ai.ts:2`. Fix: commit the eight files with `netlify/shared/`, run `tsc -b`, redeploy from `main`. Effort S.
  3. The 26-second budget comment is false. Retries open a fresh timer (`ai.ts:168`), so the worst case is about 51 s (`ai.ts:51–53`). `max_tokens` is never sent on the default free route (`ai.ts:183`, `provider.ts:10`). Fix: pass `explicitCap` at `ai.ts:183`; use one shared deadline. Effort S.
- **SHOULD**
  1. Honour the user's format limit. The 284-word answer ignored "two sentences"; the synthesis prompt asks for 200–300 words (`ai.ts:89`). Effort S.
  2. Add tests and an eval: mock the fetch for retry, timeout, and fallback (`ai.ts:276–319`), plus a labelled query set. Effort M.
  3. Show stored per-stage times (`App.tsx:134`, `:159`), and add a demo GIF and a pipeline diagram. Effort S.
- **Not verified:** environment values; retry, timeout, fallback, 429, export, stop, and xAI paths; the 26-second limit under load.

### app-02 DocMind (RAG document intelligence): score 5/10

- **Status:** HEAD `0c9619d` (2026-08-02). Working tree: 8 modified, 2 untracked. Live JS and CSS are byte-identical to the working-tree build. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200.
- **Live task:** REAL. After uploading a generated PDF ("The Harbor Station was opened in 1987 in Lisbon."), the question "In what year was the Harbor Station opened?" returned "The Harbor Station was opened in 1987." citing page 1, in 4.1 s.
- **Agentic:** lexical retrieval first (term overlap, `api.ts:40–76`), then one LLM call that returns the answer, cited chunk indices, and a confidence number. No planning, tools, memory, or evals. Trace is visible only while loading. Cost display no.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The "confidence" figure is the model's self-rating, requested in the JSON prompt (`ai.ts:116–122`). The UI labels it "High confidence · 100%" (`ChatInterface.tsx:299–310`) and describes it as how much to trust the answer (`App.tsx:256`). Fix: relabel it as self-rated, or verify it against the cited passage. Effort S.
  2. Page markers (`--- Page N ---`) stay in chunk text (`pdf.ts:77`; `chunk.ts` uses them for page attribution), so they reach the prompt and the UI. Fix: strip them after page mapping. Effort S.
  3. Dead configuration: `MAX_OUTPUT_TOKENS` (`ai.ts:7`) is never sent on the default route, and `getProvider` ignores its argument (`provider.ts:5`). Fix: pass an explicit cap, and make `getProvider` use its argument. Effort S.
- **SHOULD**
  1. Keep the stage trace after the answer; it disappears once loading ends (`ChatInterface.tsx:186–206`). Effort S.
  2. Retrieval is term overlap (`api.ts:40–76`). Add a labelled Q&A set (2–3 PDFs, recall@20, accuracy) and unit tests. Effort M.
  3. Show token usage and cost (never read, `ai.ts:189–191`), and add a demo GIF and a flow diagram. Effort S.
- **Not verified:** environment values; content retry; 402, 429, and 502 copy; stop button; rate limiter; xAI path; TXT and large PDFs; recall beyond one question.

### app-03 CodeLens (AI code review agent): score 5/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 6 modified, 2 untracked. Live JS and CSS are byte-identical to the working-tree build; HEAD's build differs. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200.
- **Live task:** REAL. A two-line `divide` function returned "Division by zero is not handled, which will raise ZeroDivisionError if b is zero…" with a suggested fix, in 16.0 s.
- **Agentic:** a single LLM call, with one retry on empty or truncated output and a provider fallback (up to four calls; working tree only). The trace stages are hard-coded. Served model and latency are shown. No planning, tools, memory, or evals.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The live site runs uncommitted code. `netlify/shared/` is untracked and imported at `ai.ts:2–10`. Fix: commit the six modified files with `netlify/shared/`, rebuild from `main`, and confirm the asset bytes match. Effort S.
  2. A raw network error reaches users. An aborted request shows "Failed to fetch": `App.tsx:104` displays `err.message`, and `src/lib/api.ts:66` maps nothing. Fix: map it to a generic message and log the raw error. Effort S.
  3. The README promises "critical/warning/suggestion/praise" (root README line 36). The code has `critical | warning | info` (`src/types/index.ts:1`). Fix: correct the README line. Effort S.
- **SHOULD**
  1. Add tests and an eval: unit tests for `ai.ts:91–113` and `:303–328`, a 10-snippet eval with expected findings, and a README GIF. Effort M.
  2. Make the trace real. The stages are hard-coded (`ai.ts:223–225`, `:245`, `:330`), and the "Agent" label (`Header.tsx:70`) overclaims a single call. Effort M.
  3. Honour the Haiku pin, or delete it. `getProvider` ignores its argument (`provider.ts:120`) and defaults to `openrouter/free` (`provider.ts:126`), so the live served model is a free preview (`dots-studio/dots-3-note-preview:free`). Effort S. Also clamp `maxComments` to the line count (`ai.ts:28`, `:215–218`): the prompt asks for five findings on a two-line file.
- **Not verified:** environment values; upstream call count per action (one client POST observed); the 20-per-minute rate limit; the mobile check covers the result state only; Chromium only.

### app-05 DataPilot (AI data analyst): score 5/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 5 modified, 2 untracked. Live JS is byte-identical to the working-tree build and to the 2026-08-23 `dist/`. Live CSS matches HEAD's build and differs from the working tree by one utility rule. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200.
- **Live task:** PARTIAL. "Which category has the highest total?" returned "Displays the sum of revenue for each product, highlighting which product has the highest total revenue." in 10.4 s. The sample has no category column, so the model chose product × sum(revenue). The engine's output is correct (agent check: top product Gadget Y, 270,000), but the text names no product, and the chart labels are hidden at 1366×850.
- **Agentic:** a single LLM call returns a structured query plan, and a deterministic client executor computes the result. Not an agent loop. No planning, tools, or evals beyond a schema guard; memory is UI-only history. Retries and trace (stage names and total ms) exist in the working tree only. Served model shown; no cost display.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The live server and client depend on uncommitted code. `ai.ts:2–8` imports the untracked `netlify/shared/provider.ts`. Live responses include `served_provider`, which HEAD does not return (zero matches at HEAD). Fix: commit `netlify/shared/` with `ai.ts`, rebuild from `main`, redeploy from git. Effort S.
  2. The answer and chart are clipped at 1366×850. The chart card is 251 px tall, none of the five category labels is visible, and the Data Preview header is cut off (confirmed in the screenshot). Fix: `flexShrink: 0` on the chart card and on the `AnalysisPanel.tsx:31–40` root (`src/App.tsx:299–306`, `src/index.css:133–136`). Effort S.
  3. The requested model is not the served model. `ai.ts:174` requests Haiku; `provider.ts:78` ignores the argument; the live response served `dots-studio/dots-3-note-preview:free`. The free route also gets no token cap (`provider.ts:43`). Fix: pass the model through, always send `max_tokens`, and disable reasoning. Effort S.
- **SHOULD**
  1. Put the answer in words. Compute the top group and value in `src/lib/dataEngine.ts`, show them, and say when a question names a missing column. Effort S.
  2. Add per-stage timings and token cost to the response (`ai.ts:318–323` returns stage names and total ms only). Effort S.
  3. Add evals and one repair retry on `validateQueryPlan` failure (`ai.ts:313–316`) instead of a 422, plus 15–20 golden questions across the three samples in CI. Effort M.
- **Not verified:** environment values; fallback, content-retry, rate-limit, empty-response, and 5xx paths (one call only); CSV upload; other viewports.

### app-06 ModelArena (multi-model LLM playground): score 4/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 5 modified, 2 untracked. Live JS and CSS match the 2026-08-23 `dist/`; the working-tree CSS differs by one rule. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200.
- **Live task:** FAILED. "Reply with exactly the word READY." on the default panel returned "Model provider rejected the request (status 404)" in 1.1 s. The function returned HTTP 200 as a stream. The second panel was blocked by the test harness, so its "Connection lost" card is not an app defect.
- **Agentic:** each panel is one LLM call, and panels run in parallel. Streaming, per-panel status, latency, and token metrics are present. No planning, tools, memory, or evals. Trace yes; cost display yes.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The default panel "Nemotron 30B Free" maps to `nvidia/nemotron-3-nano-30b-a3b:free` (`ai.ts:22`). That ID is absent from OpenRouter's public catalogue of 467 models; only the paid variant is listed. Every default run shows a failed card. Fix: probe the endpoint, then point the panel at a listed model or change the defaults. Effort S.
  2. The live site runs uncommitted code. HEAD's `ai.ts` has no `free-router-*` keys (zero matches; the working tree has seven), and the live site accepts them. Fix: commit `provider.ts` with `ai.ts`, `models.ts`, and `App.tsx`; rebuild; redeploy. Effort S.
  3. Latent cost mislabel (not reachable while `OPENROUTER_API_KEY` is set, as in production). Without the key, `getProvider` falls back to xAI (`ai.ts:194`), and the "free" panels run paid Grok models (`grok-4.5` and so on). The price table gives `free-router-*` zero cost, so unreported costs display as "~$0.00000" (`models.ts:61–64`, `ResponsePanel.tsx:216–220`). Fix: fail closed for `free-router-*` without the key. Effort S.
- **SHOULD**
  1. Check every `OPENROUTER_FREE_MODELS` ID against the catalogue before each deploy (`ai.ts:20–24`). Effort S.
  2. Add per-model evals beside latency (for example, READY compliance and pass rate). Today the "winner" is only the fastest panel (`App.tsx:79–84`). Effort M.
  3. Add tests and proof: Vitest for `validate()`, `generationOptions()`, and the SSE parser, plus a GIF of a successful run in the README. Effort M.
- **Not verified:** `free-router-c` and `free-router-a` were not exercised live (the `free-router-c` ID is listed, so the app may be partly working); retry, capped, and reasoning-token paths; xAI fallback and environment values; mobile visuals; lint.

### app-04 VoxAI (voice assistant): score 3/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 7 modified, 3 untracked. Live JS and CSS are byte-identical to the working-tree build; HEAD's build differs. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. The functions pass 10 of 10 stubbed local cases at HEAD and in the working tree. Live HTTP 200. The bundle key scan is clean.
- **Live task:** FAILED. "Reply with the single word: pong" (text box) returned "The assistant failed to respond. Try again in a moment." The function answered HTTP 502 in 0.9 s, and the upstream status was a 4xx, not 429 or 402. A retry after 30 s returned 502 again. The microphone path was not exercised.
- **Agentic:** a single LLM call, with speech-to-text and text-to-speech around it. No planning, tools, or evals. Memory is client-side conversation state. Trace: client state labels. Served model shown in the working tree only.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The live chat is down. `provider.ts:8–11` and `:17–19` default to `nvidia/nemotron-3-nano-30b-a3b:free`, which is absent from OpenRouter's public catalogue of 467 models; `nvidia/nemotron-3.5-lightning:free` is listed. `getProvider` ignores its argument (`provider.ts:13`), so `CHAT_MODEL` (`ai.ts:4`, `:50`) never applies. The same dead ID drives app-06's default panel. Fix: on an upstream 4xx, retry with `VERIFIED_CHAT_MODELS[1]`; delete the dead argument; re-probe once. Effort S.
  2. The live code is uncommitted, and `main` disagrees with the README. The live client matches the working tree (`index-DJmmlA4X.js`), not HEAD (`index-CnOFXYD5.js`). `netlify/shared/provider.ts` and `src/lib/browser-transcript.ts` are untracked. HEAD's `ai.ts:5` pins `claude-haiku-latest`, and HEAD's `transcribe.ts` calls OpenRouter (`:93–95`). The working tree calls Deepgram, which the README documents (`README.md:152`). So the README matches the working tree, and HEAD does not. Fix: commit the ten changed files, confirm which speech-to-text provider ships, make the README match it, then rebuild and compare asset bytes. Effort S.
  3. "Streaming chat" is false. `README.md:43` promises it, but `ai.ts` returns one JSON body (zero `stream: true`, zero `text/event-stream`), and `App.tsx:197–202` waits for the whole reply. Fix: drop "streaming" from that line, or implement SSE. Effort S.
- **SHOULD**
  1. Show the cause. Upstream errors other than 402 and 429 share one 502 message (`ai.ts:118–120`). Fix: distinct copy, and a health probe. Effort S.
  2. Stream for real, if streaming stays in the pitch. OpenRouter accepts `stream: true`. Effort M.
  3. Turn the stub harness into committed tests, with unit tests for `ai.ts:34–42` and `transcribe.ts:40–74`. Effort M.
- **Not verified:** microphone capture, waveform, and speech synthesis (no microphone in headless); Deepgram transcription and the browser-speech fallback; upstream status details; environment variables (by rule); cancel during a live reply; the success layout (stubbed only); rate limits.

### app-07 ContentForge (agentic content pipeline): score 3/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 4 modified, 2 untracked. Live JS is byte-identical to the working-tree build. Live CSS differs by two utility rules (`.block`, `.fixed`); cause not isolated. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no test script, no tests. Live HTTP 200.
- **Live task:** PARTIAL. "Why unit tests matter for small teams." completed all five steps in 30.6 s (five upstream calls; the slowest, Polish, took 21.4 s). The final output was "User Safety: safe", the label from `nvidia/nemotron-3.5-content-safety:free`, not an article.
- **Agentic:** a fixed five-step pipeline (Research → Outline → Draft → Edit → Polish) with a candidate loop per step that retries on empty output. No planning, tools, memory, or evals. Trace yes; cost display no. Streaming: none in the working tree (see MUST 2).
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The Polish step accepts a moderation label as the article. The candidate loop (`ai.ts:270–280`) takes the first non-empty answer that did not stop on length, and never checks the content. The candidate list includes `openrouter/free` (`provider.ts:12`), which can route to the content-safety model. App-07 has no content-safety guard (zero matches); app-08 has one (`app-08 ai.ts:343`). Fix: drop `openrouter/free` from the Polish candidates, port the guard, and reject output much shorter than its input. Effort S.
  2. The live site regressed, and the copy overclaims. HEAD's `ai.ts` streams upstream (`stream: true`, twice). The working tree has no such call, and the candidate callback is a no-op (`() => {}`, `ai.ts:273`). The copy still promises streaming ("Full SSE streaming", root README lines 61–62). Fix: reword the copy, or restore streaming. Effort S.
  3. The live site runs uncommitted code. `netlify/shared/` and `.gitignore` are untracked, the live JS matches the working tree, and `ai.ts` alone fails `tsc` (TS2307 at `ai.ts:2`). Fix: commit `netlify/shared/provider.ts` with the four modified files and `.gitignore`. Effort S.
- **SHOULD**
  1. Log every candidate attempt (model, status, milliseconds, reject reason) and show it in the trace; only the winner shows today. Effort S.
  2. Parse the OpenRouter usage block (`ai.ts:156–166` ignores it) and show tokens and cost per step. Effort S.
  3. Add a critic step that scores the draft against the outline and loops once, and unit-test the candidate loop. Effort M.
- **Also:** `App.tsx:92` contains a literal NUL byte in `runKey` (present at HEAD too), so git treats the file as binary. Write `\u0000` in the template literal. Effort S.
- **Not verified:** step texts (not captured); why the first Polish candidates failed (inferred from timings); Stop, Resume, and Retry (one-task rule); whether the classifier output reproduces (the router is random); the 30-second platform limit against Netlify's docs; `npm audit` (two high, transitive).

### app-08 VisionLab (multimodal vision AI): score 6/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 6 modified, 2 untracked. Live JS and CSS are byte-identical to the working-tree build and to the repo's 2026-08-23 `dist/`. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200.
- **Live task:** REAL. A generated image reading "HELLO 42" (1200×400), asked "What words and number appear in this image?" in Q&A mode, returned "Based on the image, the word HELLO and the number 42 appear." in 4.2 s.
- **Agentic:** a single vision LLM call (two in the worst case, via fallback). No planning, tools, or evals; the gallery is client-only memory. Retries exist in code only and were not exercised. Trace: the analysis panel shows stages. No cost display. Validation covers completeness only (`api.ts:178–185`).
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The vision model is unpinned and differs from HEAD. HEAD pinned `~anthropic/claude-sonnet-latest` (`HEAD ai.ts:196`). The working tree still passes that name (`ai.ts:134`), but `getProvider` ignores its argument (`provider.ts:4`), and the default route is `openrouter/free` (`provider.ts:6`). The live response served `dots-studio/dots-3-note-preview:free`. Fix: pass the model through, or delete the dead argument; pin `OPENROUTER_MODEL` to a vision-capable model. Effort S.
  2. The copy overclaims the model and the check. "Powered by a real provider-backed vision model" (`DropZone.tsx:91`) and "vision-capable model" (`README.md:67`) imply a fixed model, and "Validated complete response" (`App.tsx:259`) rests on a check that only confirms the stream completed (`api.ts:178–185`). Fix: say the routed model varies, and rename the label to "Response complete". Effort S.
  3. The live site runs uncommitted code. `netlify/shared/` and `.gitignore` are untracked; the live JS and CSS match the working tree; and `ai.ts` alone fails `tsc` (TS2307 at `ai.ts:1`). Fix: commit `netlify/shared/provider.ts` with the six modified files and `.gitignore`. Effort S.
- **SHOULD**
  1. Always send `max_tokens`. `openrouter/free` omits it (`provider.ts:2`), so the 25-second watchdog (`ai.ts:32`) is the only cap. Effort S.
  2. Show fallback decisions in the trace. The DeepSeek fallback (`ai.ts:287–324`) and the content-safety rejection (`ai.ts:340–343`) appear only as the final provenance line. Effort S.
  3. Add proof: a fixed image set with expected answers and a pass-rate script, a README demo GIF, and an architecture diagram. Effort M.
- **Not verified:** one live sample (the router's pick varies); the DeepSeek fallback and content-safety rejection never fired, and the fallback model name is unverified; describe, analyze, and extract modes not run; Cancel, gallery, and zoom not exercised; the 20-per-minute rate limit (`ai.ts:36–38`) and 60-second client timeout (`api.ts:9`) not hit; whether `OPENROUTER_MODEL` is set on Netlify (inferred from the served model; environment not read); mobile checked for overflow only.

### app-09 InsightHub (SaaS analytics dashboard): score 5/10

- **Status:** HEAD `19514e7` (2026-08-03). Working tree: 6 modified, 2 untracked. Live JS and CSS are byte-identical to the repo's 2026-08-23 `dist/`. That build embeds the Supabase configuration, which a fresh local build cannot reproduce, because the repo has no `.env`. Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200. The secret scan found one JWT in the live bundle, with role `anon`; no `service_role` key.
- **Live task:** REAL, in part. Demo mode (guest path), then "Generate Insights" once: the first figures match the panel (usage up 30.9% in API calls and 29.6% in tokens; latency down 13.5% to 253 ms). Later points include unsupported inference, such as "top 10% of endpoints". Latency 14.6 s.
- **Agentic:** a single streamed LLM call over a metrics snapshot. No planning, tools, memory, evals, or retries (xAI fallback only). Trace: one stage line. Cost display: latency and served model only, with no tokens or cost.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The committed code is not the live code. HEAD's `ai.ts` has no `served_model` frame, and `ai.ts:1` imports the untracked `netlify/shared/`. Fix: commit `ai.ts` with `netlify/shared/` (`ai.ts` alone breaks the build), then redeploy from git. Effort S.
  2. Uncapped output and a dead model setting. `openrouter/free` gets no `max_tokens` (`provider.ts:2`), and `getProvider` ignores its argument (`provider.ts:4`), so `INSIGHTS_MODEL` never applies. The live call was served by `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. Fix: pass the model through, always send `max_tokens`, and turn reasoning off. Effort S.
  3. Overclaimed copy. The UI shows "Validated complete insight" whenever the stream sends a `complete` frame (`InsightsPanel.tsx:40`), with no check of the content. The page says the app "tells you what's actually happening" (`docs/index.html:987`), but the data is seeded (`Dashboard.tsx:170–173`). Fix: change the label to "Analysis complete", and describe the data as a seeded demo dataset. Effort S.
- **SHOULD**
  1. Add a groundedness check: match each figure in the insight to the metrics snapshot and show "n of m verified". This would flag the unsupported "top 10%" line. Effort M.
  2. Show the OpenRouter usage (prompt, completion, reasoning tokens) beside the served model; `ai.ts:253–260` keeps only the model and the delta. Effort S.
  3. Add tests and an eval fixture (none exist) for the SSE parser (`api.ts:25–43`) and the metric sanitiser (`ai.ts:100–122`). Effort M.
- **Also:** `isAuthReachable` (`src/lib/supabase.ts:23`) is never called, so the startup-probe comment at `AuthPage.tsx:63` is false.
- **Not verified:** the raw SSE body (a protocol error in the browser harness; stage and provenance were read from the UI); the signed-in path (no account, by rule); 429, 502, 503, and no-key paths; live model environment values.

### app-10 BrowseBot (AI browser-task planner): score 6/10

- **Status:** HEAD `f9ffa26` (2026-08-03). Working tree: 9 modified, 3 untracked, 2 deleted. Live JS matches the working tree and the 2026-08-23 `dist/`. Live CSS matches neither local build (cause not isolated). Last deploy: CLI, 2026-08-23.
- **Build and tests:** HEAD PASS; working tree PASS; no tests. Live HTTP 200. HEAD has no `/api/execute`; the working-tree client calls it, and the live endpoint answers 405 to a GET, so it exists live.
- **Live task:** REAL. "Open google.com and report the page title." ran a Browserbase session and returned the title "Google" with the page's content, from https://www.google.com/. Latency 6.1 s.
- **Agentic:** a fixed pipeline: one planner call, then a deterministic Browserbase executor with no feedback from the model. The planner retries once on empty or truncated content. Planning yes; tools yes (browser); trace yes. Cost display partial: served model and session ID only, with no tokens, cost, or timing. No memory or evals.
- **Proof:** no tests, evals, demo media, or diagram. TypeScript strict; zero `any`.
- **MUST**
  1. The repo contradicts the live site. HEAD lacks `execute.ts` and `netlify/shared/`, and HEAD's planner asks for "real-sounding" data and renders a mock page (`ai.ts:107`, `:111`). A GitHub-linked deploy would revert the live app. Fix: commit the reviewed working tree and redeploy from git. Effort S.
  2. "Generate Plan" starts a billable session at once, and the copy promises an "approved plan" (`docs/index.html:1016`; `App.tsx:86–89`, `:185`). Most presets name no allowlisted site, so they are predicted to be blocked (`constants.ts:4–10`, `execute.ts:21`). Fix: relabel as "Plan and run", put the allowlist in the planner prompt, and replace the presets. Effort S.
  3. Open billable endpoints. Both functions send `Access-Control-Allow-Origin: *` (`ai.ts:2`, `execute.ts:6`), with no origin check and no rate limit (zero limiter matches). The session is opened outside the try block (`execute.ts:205–209`). Fix: port app-09's origin allowlist and limiter (`app-09 ai.ts:19–75`). Effort S.
- **SHOULD**
  1. Add an outcome check. The executor only snapshots the page (`execute.ts:173–174`), so "execution complete" reports whatever happened. Compare the observed page against the expected one. Effort S.
  2. Show per-step truth. `App.tsx:58` overwrites each snapshot; the address bar shows the planned URL (`BrowserChrome.tsx:15`); the session ID appears only at completion (`AgentThoughts.tsx:171`). Effort M.
  3. Allow one bounded replan: on a failed find or click, send the observed snapshot back to the planner once (`execute.ts:214–221` has no feedback path). Effort L.
- **Not verified:** other presets and routing beyond google.com (one-task rule); Stop, Retry, and the 503 path; the `/api/execute` event order; Browserbase cost and cleanup; the content-retry timeout (predicted 17 s against a 10 s cap); live environment values.

## 5. Portfolio page

Page: https://jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/ (source `docs/index.html`). **Score 5/10:** broad, live, and mostly honest, but no per-app proof, a dead contact path, and overclaims a technical reviewer can check.

- **Status:** HTTP 200, title "Christopher John Gentile — Generative AI & Hyperagentic Engineer", last Pages deploy 2026-08-23 (`8e23a17`).
- **Links:** 16 of 16 checkable links return 200. Of the 18 extracted, the two failures are bare Google Fonts preconnect origins. Mailto contacts can't be checked over HTTP.
- **Layout:** no horizontal overflow at 1440 px or 390 px (viewport emulation), no console errors, no broken images, meta description present.

Copy audit. Verdicts marked "(agent)" are the portfolio agent's judgment and were not re-checked; the rest I verified in the repo.

| Page claim | Verdict | Evidence |
| --- | --- | --- |
| "live, deployed, and handling real requests" | OVERCLAIM | 10 of 10 return 200 (agent). Request handling not exercised. Provider-credit condition in the root README (line 7) is absent from the page: zero matches for "credit". |
| "Free Router" / "OpenRouter Free" (lines 632, 642, 683) | OVERCLAIM | app-01 and app-10 default to `~google/gemini-flash-latest` (`netlify/functions/ai.ts:17` and `:11`). app-01 uses the free route only on retry (agent). |
| "each product names its actual provider" | OVERCLAIM (agent) | Cards name one provider on 5 of 10. |
| "the ten applications below are the proof" | OVERCLAIM | Zero `<img>`, `<video>`, or GIF references on the page. |
| "agents architect, code, test, and deploy" | OVERCLAIM (agent) | Commits exist, but deploys are manual CLI uploads and there is no test evidence. |
| "InsightHub streams a validated insight" (line 987) | OVERCLAIM | Seeded-data disclosure is true. No zod or schema validation in app-09 source. |
| "five n8n workflows with real executions and full evidence trails" | OVERCLAIM (agent) | Nine execution screenshots cover the five. No execution logs. |
| "runnable with zero third-party accounts" (line 1051) | OVERCLAIM | Five workflow JSON files carry OpenRouter or OpenAI credential types. |
| "10 independently deployed apps; React 19, TypeScript 5, Vite 6, Tailwind v4; built with Claude Code" | TRUE | 10 hosts return 200. 23 "Co-authored-by: Claude" trailers in history (case-insensitive count). |
| "four agents and a downloadable report; DataPilot computes in the browser" | TRUE (agent) | Four agent roles; DOCX export; DataPilot's model sees five sample rows. |
| "bounded Browserbase run on an allowlist" | TRUE in code | Live run UNVERIFIED. |
| "ContentForge: five stages, streaming every word" | UNVERIFIED | Live run not exercised. Code budgets 26 s per step. |

- **Hiring-manager view (30 seconds):** the hero is confident and shows "10 Live Apps", but there is no product visual and no eval number. Each card maps to its app, and the seeded-data and allowlist disclosures read honestly. The downgrade risks are the dead contact, "Free Router", and "validated insight". The "Live" badges are static text: the page has no `fetch()` calls, so they don't reflect status.

MUST (broken or misleading):

1. Both mailto links go to `jdgafx@users.noreply.github.com` (`docs/index.html:702` and `:1070`), which does not deliver mail. Fix: point them at an inbox you monitor. Effort S.
2. The hero and About imply free, always-on AI with no provider-credit caveat (`:632`, `:642`, `:683`). Fix: add a credit line and reword "Free Router". Effort S.
3. "Validated insight" (`:987`) and "zero third-party accounts" (`:1051`) are unbacked. Fix: reword to match the code, or add a schema check to app-09. Effort S.

SHOULD (makes the agentic work visible):

1. Surface the nine n8n execution screenshots already in `n8n-automations/docs/img`. The page has no images. Effort S.
2. One proof frame per app (screenshot or 10-second GIF) on each card. Effort M.
3. One line under the hero naming AgentFlow's four roles (Researcher, Analyst, Critic, Synthesizer), linked to the app. Effort S.

Not verified: live AI paths and provider credit (handling, ContentForge, BrowseBot); page-versus-deployed parity; defaults for apps 02–05, 08, and 09; a second handle ("CGDarkstardev1") in nav and meta that no link uses.

Screenshots (session scratchpad): `portfolio/desktop-first-screen.png`, `desktop-full.png`, `mobile-first-screen.png`, `mobile-full.png`.

## 6. Ranked portfolio-wide plan

Ranked by hiring impact. Each item names the apps it affects and the effort.

1. **Make what is live reproducible (S, then M).** Every app has untracked shared server code (`netlify/shared/`), and app-10's `execute.ts` is untracked. HEAD's server code no longer matches the UI in several apps: app-06 sends `free-router-*` IDs that HEAD does not recognise, app-10's client calls `/api/execute`, which HEAD lacks, and app-04's HEAD and working tree use different speech-to-text providers. Commit the working tree with the per-app `.gitignore` and `netlify/shared/` files. Then either reconnect the GitHub App (a browser OAuth step only you can do) or document CLI deploys and remove "auto-deploys on push" from the README. Nothing else is reproducible until this is done.
2. **Fix the three first-click failures (S each).** App-04 and app-06 both default to `nvidia/nemotron-3-nano-30b-a3b:free`, which is absent from OpenRouter's catalogue. Probe, then switch the default to a listed model (`nvidia/nemotron-3.5-lightning:free` is listed). App-07's Polish step publishes the moderation label "User Safety: safe" as the article: drop the free router from the Polish candidates, port app-08's content-safety guard, and reject output far shorter than its input. App-05's answer and chart labels are clipped at 1366×850: add `flexShrink: 0` to the chart card and the analysis panel root.
3. **Remove the overclaims a reviewer can test (S each).** Streaming: app-01 says "real-time SSE streaming" but emits each stage at completion; app-04 says "streaming chat" but returns one JSON body; app-07's README says "Full SSE streaming", but its working tree no longer streams upstream. Validation labels: app-09 says "Validated complete insight" and app-08 says "Validated complete response", but both check only that the stream completed; app-02 presents a self-rated number as confidence. Portfolio page: "Free Router" and "validated insight" with no provider-credit caveat, "zero third-party accounts" (five n8n workflows carry OpenRouter or OpenAI credentials), the dead `noreply` contact (two mailto links), and "the ten applications below are the proof" with no media on the page.
4. **Make the served model match what the UI claims (S each).** `getProvider` ignores its argument in apps 02, 03, 04, 08, and 09, so the model settings in code never apply. Free routes receive no `max_tokens` in apps 01, 02, 05, 07, 08, and 09, so output is uncapped. The free router serves preview and reasoning variants (for example `dots-studio/dots-3-note-preview:free`). App-01 and app-10 default to a paid Gemini model, while the README says the default is `openrouter/free`. Pin the model through one function, always send `max_tokens`, and keep showing the served model.
5. **Lock down the billable endpoints (S–M).** App-10's two functions send `Access-Control-Allow-Origin: *` with no rate limit, and "Generate Plan" starts a Browserbase session at once. App-07 also sends `*` (agent report). App-09 already has an origin allowlist and a 20-per-minute limiter (`ai.ts:10–11`, `:20`, `:53–57`). Port that pattern to every function that calls a paid API.
6. **Add proof for hiring managers (M).** All ten apps have zero tests and zero evals; the root `test-all-apps.sh` is a live smoke suite, not unit tests. No app card has demo media, and none of the ten app folders has a README. Start with the three lead apps: a GIF of a successful run, a README with an architecture diagram, and 10–20 golden cases with expected answers.
7. **Make the agent behaviour observable and self-correcting (M–L).** Traces are hard-coded or show only the winning candidate (apps 03, 07, 09). App-10 runs a one-shot plan and never checks the outcome. App-05 returns 422 on a bad plan instead of allowing one repair turn. App-02 retrieves by term overlap. App-09's insight has no groundedness check. Add per-step timings and token cost to every response, an outcome check and one bounded repair or replan (apps 05 and 10), and a labelled eval set (apps 02, 03, 05, 06, and 08).
8. **Repo hygiene (S).** Commit the per-app `.gitignore` files and `netlify/shared/`. Remove the NUL byte in app-07's `App.tsx:92`. Fix the severity list in the root README (app-03) and the speech-to-text row (app-04). Confirm nothing imports app-10's two deleted files before committing. Decide what to do with the 36 untracked screenshots and logs at the repo root. Nothing was deleted in this audit.

## 7. Which apps to lead with

Lead with **app-10 (BrowseBot)**, **app-01 (AgentFlow)**, and **app-02 (DocMind)**, in that order, once their MUST items are fixed.

- **App-10** is the only app where an agent acts on the live web and returns observed page content: the clearest tool-use proof. Lock down its billable endpoints and fix its "approved plan" copy first.
- **App-01** shows a visible four-role pipeline with live token counts, which is recognisable as multi-agent work. Fix the streaming copy first.
- **App-02** is the clearest retrieval example, with a cited page-1 answer. Relabel the confidence figure first.
- **App-08** (6/10) is a strong visual demo, but it is a single call, so it sits in the second tier.
- **Do not lead with app-04, app-06, or app-07** until their first-click failures are fixed.

## 8. Limits

- **Live tests:** one real task per app, run in headless Chromium through Playwright. There is no microphone, so app-04's voice capture, waveform, and speech synthesis are not verified.
- **Builds and byte checks:** each app was built from a clean HEAD export and from a working-tree copy, both in scratch. The live entry JS and CSS were compared byte for byte with both builds and with the repo's 2026-08-23 `dist/`.
- **Netlify facts** came from read-only CLI calls (sites, deploys, build settings). No environment values were read. Secret checks covered client bundles only, and no matched values were printed.
- **Code references** come from six audit agents. I spot-checked the load-bearing ones; the rest are the agents' reports and may have small line drifts.
- **OpenRouter catalogue:** read once from the public `/models` endpoint (467 models), with no key.
- **Repo smoke suite:** `test-all-apps.sh` was run once against production (section 3).
- **Scope:** nothing was edited, committed, pushed, deployed, or changed in any setting. Subagents did not write report files: several believed a rule barred `.md` files in this session, and none applies to the scratch folder. Their final messages are the record.

## Appendix A: uncommitted and untracked items (103)

Totals: modified 65, deleted 2, untracked 36. Nothing was deleted or committed.

- **app-01** modified (8): index.html, netlify/functions/ai.ts, src/App.tsx, src/components/Header.tsx, src/components/QueryBar.tsx, src/components/StatusPanel.tsx, src/index.css, src/types/index.ts. Untracked (2): .gitignore, netlify/shared/
- **app-02** modified (8): netlify/functions/ai.ts, src/App.tsx, src/components/ChatInterface.tsx, src/components/UploadZone.tsx, src/index.css, src/lib/api.ts, src/lib/pdf.ts, src/types/index.ts. Untracked (2): .gitignore, netlify/shared/
- **app-03** modified (6): netlify/functions/ai.ts, src/App.tsx, src/components/Header.tsx, src/components/ReviewPanel.tsx, src/lib/api.ts, src/types/index.ts. Untracked (2): .gitignore, netlify/shared/
- **app-04** modified (7): netlify/functions/ai.ts, netlify/functions/transcribe.ts, src/App.tsx, src/components/Conversation.tsx, src/components/Header.tsx, src/index.css, src/lib/api.ts. Untracked (3): .gitignore, netlify/shared/provider.ts, src/lib/browser-transcript.ts
- **app-05** modified (5): netlify/functions/ai.ts, src/App.tsx, src/components/AnalysisPanel.tsx, src/components/QueryBar.tsx, src/types/index.ts. Untracked (2): .gitignore, netlify/shared/
- **app-06** modified (5): index.html, netlify/functions/ai.ts, src/App.tsx, src/index.css, src/models.ts. Untracked (2): .gitignore, netlify/shared/
- **app-07** modified (4): netlify/functions/ai.ts, src/App.tsx, src/index.css, src/lib/api.ts. Untracked (2): .gitignore, netlify/shared/
- **app-08** modified (6): index.html, netlify/functions/ai.ts, src/App.tsx, src/components/AnalysisPanel.tsx, src/components/DropZone.tsx, src/lib/api.ts. Untracked (2): .gitignore, netlify/shared/
- **app-09** modified (6): netlify/functions/ai.ts, src/App.tsx, src/components/Dashboard.tsx, src/components/InsightsPanel.tsx, src/components/MetricCard.tsx, src/lib/api.ts. Untracked (2): .gitignore, netlify/shared/
- **app-10** deleted (2): src/components/MockPageContent.tsx, src/lib/sample.ts. Modified (9): index.html, netlify/functions/ai.ts, package-lock.json, package.json, src/App.tsx, src/components/AgentThoughts.tsx, src/components/BrowserChrome.tsx, src/lib/api.ts, src/types/index.ts. Untracked (3): .gitignore, netlify/functions/execute.ts, netlify/shared/
- **root** modified (1): test-all-apps.sh. Untracked (14): .playwright-mcp/, 01-initial-load.png, app09-desktop-dashboard-insights.png, app09-mobile-375-dashboard.png, contentforge-exact-run1-console.txt, contentforge-exact-run1-desktop.png, contentforge-exact-run1-mobile.png, contentforge-exact-run1-network.json, contentforge-exact-run3-console.txt, contentforge-exact-run3-mobile.png, contentforge-exact-run3-network.json, phase3-app09-mobile-fixed.png, phase3-app10-mobile-planner-final.png, phase3-app10-mobile-planner.png
