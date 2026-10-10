# DocMind: document question answering with retrieval

DocMind answers questions about one document. The document is a live Wikipedia article, an arXiv paper, or a PDF or TXT file you upload. You ask a question and get an answer with the passages it used and where each sits: a section for an article, a page for a PDF. The text is read in your browser. The browser ranks every passage with BM25 and sends only the best 20 to the model. Each answer shows the steps it ran, with timings, token counts, cost, and the model that served it.

What this showcases: retrieval you can check. The browser retrieves the passages and shows their BM25 scores with the matched words marked. The model cites only the passages it was given, and each citation in the answer is a button that opens the passage with the supporting sentence marked.

## Evidence you can see

- **Retrieval.** The Evidence panel lists the five best passages for the question with a bar for each BM25 score (scaled to the best one), the passage number and its page or section, and the question words marked in the text. The other 15 passages that were sent are listed below by score. A map shows where in the document the sent and cited passages sit.
- **Clickable citations.** The model writes a marker such as `[Chunk 12]` after each claim. The page turns each marker into a numbered button (the passage number the panel uses, counted from 1). The sources list under the answer has the same buttons.
- **Source panel.** A citation opens its passage with the text on each side. The supporting sentence is marked. It is chosen by a fixed rule: for each answer sentence that cites the passage, the passage sentence that shares the most distinct content words (after stemming) with it. A tie goes to the earlier sentence. A passage cited by two answer sentences can show two marks. When no sentence shares a word, nothing is marked.
- **Not in the document.** When the model says the document does not answer and cites nothing, the answer is labelled "Not in the document" and lists the best-scoring passages it was given. Each one opens in the panel. When no passage shares a word with the question, the model is not called and the page says all passages were checked.

## Where documents come from

- **Wikipedia.** Search by title with live suggestions, or start from one of three article titles. The browser fetches the article text from `en.wikipedia.org/w/api.php` when you choose it, so it is the article as it is today. Each section becomes a numbered unit (`--- Page N ---` markers, the same ones the PDF reader writes), titled with its heading. Nested sections read "Parent > Child". Empty headings, the reference lists at the end (See also, Notes, References, Further reading, External links) and everything under them are left out. The UI calls these units sections, not pages. The text is cut at 25 MB, the size the app accepts for a file.
- **arXiv.** Enter an ID (`1706.03762`, `hep-th/9901001`) or paste an arxiv.org link, or start from an example. The browser fetches `https://arxiv.org/pdf/<id>` directly, because arXiv allows cross-origin reads of its PDFs. The host is fixed in the code and the ID must match the arXiv ID pattern. The reply must be `application/pdf`, and the PDF is read as a stream and at most 5 MB of it is kept. The download is abandoned when no data arrives for 15 seconds, and a request that fails outright is tried once more. The browser then reads the PDF text with the same in-browser reader as an upload, so citations say "page N".
- **Upload.** A PDF or TXT file up to 25 MB, read in the browser and never uploaded whole.

The document panel shows the title, a link to the source, and the number of passages, sections or pages, and characters. The question box starts empty. For an article, it also offers question starters built from the article's own section titles. A starter fills the box and you press **Ask**.

Live URL: https://jdgafx-app-02-rag-document-intelligence.netlify.app

## The pipeline

The steps below are the trace names the UI shows, in the order they run.

1. **Retrieve passages** (browser). Scores every passage with BM25 (k1 1.2, b 0.75, idf `ln(1 + (N - n + 0.5) / (n + 0.5))`). Words are lower-cased, stop words and question verbs such as "take" and "place" are dropped, and a small suffix stripper joins plurals and -ed or -ing forms. The index is built once per document. The top 20 go on to the server, in document order. If none shares a word with the question, the model is not called and the UI says so.
2. **Accept request** (server). Checks the question and the passage count. The step time includes the request checks made before it.
3. **Build prompt** (server). Adds the system prompt and the labelled passages, then reports the character count sent.
4. **Call model** (server). One chat call to the fixed model, limited to 12 seconds. The step reports which model served the reply.
5. **Retry model call** (server). Runs once when the first reply was empty or cut off at the output cap, or when the first call timed out or did not connect, and at least 5 seconds of the request budget remain. A provider error (a 4xx, 429 or 5xx reply) and a stop by the visitor are never retried. The trace says why it ran ("Retried once because ...").
6. **Parse and validate** (server). Reads the JSON reply, keeps only citations that name a passage that was sent, and reports the cited count and the self-rated percentage.

The Latest run section lists every step with its status, duration, and the tokens and cost of each model call. It also shows total latency, prompt, completion and total tokens, cost in USD, and the served model. A missing value reads "not reported". Cost is marked "estimated" when it comes from published catalogue prices rather than the provider's usage report.

Each answer shows its self-rated confidence as "Self-rated N%", with a note that the model rated its own answer and the rating is not checked against the passages. It also shows "Served by" and the source passages.

The map in the Evidence panel shows the whole document as a row of cells. Shaded cells hold passages the browser sent to the model, and solid cells hold passages the answer cites. "Browse the passages" opens the document's passages in a list with the same shading.

## Architecture

```
browser (React, pdf.js)
  -> Wikipedia article text fetched from en.wikipedia.org (CORS), or a PDF fetched from arxiv.org (CORS),
     or an uploaded file
  -> PDF text read locally, passages chunked (500 characters, 50 overlap)
  -> BM25 retrieval picks up to 20 passages
  -> POST /api/ai  (Accept: text/event-stream)
       Netlify Function netlify/functions/ai.ts
         -> origin check, method check, rate limit, body size, validation
         -> runAnswer (netlify/shared/answer.ts)
         -> OpenRouter chat completions (netlify/shared/provider.ts)
  <- server-sent events: start, step, result or error, then [DONE]
```

- **Content Security Policy.** `connect-src` allows `'self'`, `https://en.wikipedia.org` and `https://arxiv.org`, the two hosts the browser calls directly. The model call goes through this app's function.
- **Keys.** `OPENROUTER_API_KEY` is read only inside the function. The browser never receives it and never calls OpenRouter.
- **Model.** One server constant, the OpenRouter alias `~anthropic/claude-haiku-latest`, which resolves to the newest Claude Haiku. The UI shows the model OpenRouter answered with (currently `anthropic/claude-haiku-5.5`), never the alias. The UI has no model picker, and any model name the client sends is ignored.
- **Output cap.** Every model call sends `max_tokens: 4096` and `usage: { include: true }`, so the reply reports tokens and cost.
- **Same origin only.** The app and its function share one origin, so the function sends no CORS headers and do not answer OPTIONS. A request whose Origin header is not on the list gets 403. Requests with no Origin header are allowed.
- **Validation.** Non-POST methods get 405. Bad JSON gets 400. Bodies over 256 KB get 413. The question is at most 2000 characters, at most 20 passages are accepted, and each passage must start with its `[Chunk N]` label. Each passage is cut to 2000 characters and the title to 200.
- **Rate limit.** 20 requests per minute per client address, kept in memory by each function instance. It is a cost guard, not a quota.
- **Deadline.** One 25-second budget covers the first call, any retry, and the price lookup. The price lookup is skipped when less than a second remains.
- **Browser watchdog.** The browser gives up on an answer when no byte arrives for 30 seconds, or after 90 seconds in all, and shows a plain sentence with Try again. Stop by the visitor stays silent.
- **Errors.** Refusals before the model runs return a plain sentence in `{ error }` with a status: 400, 403, 405, 413, 429, or 500 when no key is set. Once the request is accepted, the function always answers with the event stream, and a failure is an `error` frame carrying the sentence and the steps that ran. That covers a provider rate limit, a provider failure, a timeout, and an unusable reply. Provider response bodies are logged on the server only. The UI shows an error banner and marks the failed step in the trace. A failed document load shows its own sentence and a **Try again** button.

## Run it locally

Requirements: Node.js with npm. The checks below were run on Node 22.

```bash
npm ci
npx netlify dev        # UI and function together, on http://localhost:8888
npm run dev            # UI only, on http://localhost:5173; questions need the function
```

Environment variables (names only):

- `OPENROUTER_API_KEY`: required for answers. Set it in your shell or in the Netlify site settings, never in the repository.
- `ALLOWED_ORIGINS`: optional, comma-separated extra browser origins allowed to call `/api/ai`.
- `URL`, `DEPLOY_PRIME_URL`, `DEPLOY_URL`: set by Netlify for the live site and deploy previews.

Checks:

```bash
npm test          # unit tests and function smoke tests; no provider call is made
npm run lint      # ESLint, zero warnings allowed
npm run typecheck # TypeScript project build, strict mode
npm run build     # typecheck, then the production bundle in dist/
```

The tests blank every provider key. Every function test replaces `fetch` with a stub before the handler runs, so no test reaches a provider.

## Known limits

- Retrieval matches words, not meaning. A question that uses different words from the document can find no passage, and then the model is not called. BM25 also ranks by word counts, so a passage full of the question's general words can outrank the one with the answer. That is why 20 passages are sent, not 5.
- The model sees only the passages that matched. Text that shares no word with the question is never sent.
- The marked sentence is chosen by word overlap with the answer sentence, not by meaning. When the answer sentence mixes two passages' facts, a passage can show the sentence that shares the most words rather than the one with the fact. Numbers split by a PDF's spacing ("28 . 4") match poorly.
- The model may skip a marker or cite a passage only in the source list. The panel then matches the passage against the whole answer.
- The confidence figure is the model's own rating. It is not checked against the passages.
- A passage is placed in the section or page where it starts. A passage that crosses a heading shows the earlier section.
- Wikipedia text is read as plain text. Tables, lists of links and images are not included, and an article that has no prose is refused.
- arXiv papers over 5 MB are refused. Download them and use Upload, up to 25 MB.
- arXiv's error replies carry no CORS header, so the browser cannot tell a paper that does not exist from a dropped connection. Both show one sentence that says so, after one automatic retry.
- Citations are checked against the passages that were sent. The answer text itself is not checked against them.
- The rate limit is kept in memory per function instance, so the true number of requests a site allows is higher than 20 per minute.
- Requests with no Origin header are accepted. The origin list stops other websites in a browser, not direct calls.
- A request with no Content-Length header is read in full before the size check runs. The platform's own request size limit bounds that read.
- Stop aborts the browser request. The server passes that abort to its model call when the platform reports the disconnect. If the platform does not, the model call completes and can still be billed.
- The model reply arrives whole. The server streams each step as it finishes, not the model's words.
- A PDF with no text layer, such as a scan, is rejected. There is no OCR.
- Files up to 25 MB are read in the browser. Large documents take longer to read and to rank.
- The server allows 25 seconds of model time per question. A slower reply, and a provider 5xx error, both end with "The AI provider did not answer in time."
- There is no labelled evaluation set, so retrieval quality is not measured. The six real questions in the checks were judged by hand.
