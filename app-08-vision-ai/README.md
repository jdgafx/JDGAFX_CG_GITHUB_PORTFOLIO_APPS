# VisionLab

Live: https://jdgafx-app-08-vision-ai.netlify.app

VisionLab answers questions about pictures. Upload a JPG, PNG, WebP or GIF up to 4 MB, or pick a public image from Wikimedia Commons, then ask about the whole picture, about a box you draw on it, or about two pictures side by side. The answer streams in as it arrives, and a run trace shows each step with its time, tokens and cost.

**What this showcases:** a multimodal call on a crop cut in the browser at full resolution, and a two-image comparison, each streamed and checked for completeness before it is marked done.

## Three ways to ask

- **Whole image.** Describe gives a full description of the scene. Analyze covers composition, colour, objects, visible text and image quality. Question answers one question you type. Extract pulls out text, numbers and tables in their original structure.
- **Region.** Drag on the picture to draw a box, type a question and ask. The page cuts that box out of the original at its own pixel size, with no scaling, and sends only the crop, plus a line telling the model the size of the whole picture and where the crop sat in it. The answer shows next to the crop, and the box stays drawn on the original with a tag (R1, R2 and so on). Every region you ask about is listed under the answer; select one to show its crop, answer and trace again. A crop over 4 MB is scaled down in steps until it fits, and a crop with a short side under 48 pixels is flagged in the trace. The box works with a pointer or a finger, and from the keyboard: Tab to the picture, Enter starts a box, arrow keys move it, Shift with an arrow resizes it, Enter keeps it and moves to the question, Escape clears it.
- **Compare.** Load two images (uploads or Commons picks) and one call sends both. The answer comes back under three headings, Similarities, Differences and Verdict, and the page shows them as two columns with the verdict across both, under the two pictures. The optional question is what the verdict answers. Each image is scaled down in the browser to 2 MB if it is larger, so both fit one 6 MB request.

## Pick a public image

The Image section has a "Pick a public image" panel. Three one-click searches fit the modes: a chart (Extract), a busy street (Describe and Analyze) and a sign with text (Question and Region). While comparing, a switch says which image a pick goes into. A search box takes any other words.

- **Data source:** the Wikimedia Commons API (`commons.wikimedia.org/w/api.php`, file namespace, JPEG, PNG, WebP and GIF only). The browser calls it live with `origin=*`; nothing goes through the server. Each search asks for up to 24 matches and shows the best 12.
- **The image:** the chosen result is downloaded as a standard thumbnail (1,280 px wide for a larger picture, otherwise the largest standard width no wider than the picture) from `upload.wikimedia.org` or `thumb.wikimedia.org`, which keeps it under the 4 MB limit. Result cards use 330 px thumbnails. Wikimedia throttles requests for originals, so the original is fetched only if the thumbnail request fails, and a card whose preview cannot load shows a plain "No preview" tile. It then goes through the same type and size checks as an uploaded file.
- **Attribution:** the title, author and licence from Commons, with links to the licence and to the Commons file page, show under the picture and are kept with the entry in Recent analyses. Every image keeps its own licence.
- **Failures:** a search or download that times out (12 and 25 seconds), is rate limited or cannot be reached shows a plain sentence with a retry. A search with no usable results says so.

## The pipeline

Each run has the steps below. The names match the trace exactly. Region and Compare add one step that runs in the browser first.

0. **Crop region** (Region only) or **Prepare images** (Compare only). The browser cuts the box out, or shrinks an image that is over 2 MB.
1. **Request checked.** The server checks the image type and size, the mode and the question. A failed check ends the run here, and the trace marks this step as failed. If the server cannot be reached at all, the failed step is named **Reach the server**, because the request was never checked.
2. **Model call.** The server sends the images and prompt to one vision model through OpenRouter and streams the reply back. The step shows the served model and the number of text chunks.
3. **Parse and validate.** The server checks that the reply is not empty, did not stop at the output limit, was not filtered, and was not written by a moderation model. A comparison must also carry all three parts. This is a format check. It does not check whether the answer is correct.

The page shows the trace as a waterfall: each step's bar starts where the one before it ended. Above it, a readout strip ticks while the run is live and then shows total latency, tokens, the cost in USD as the provider reports it, and the served model. A value shows "not reported" when the provider does not send it.

## Architecture

- The browser posts the image and the request fields to `/api/ai`. The page and the function share one origin, so the function sends no CORS headers.
- The Netlify Function `netlify/functions/ai.ts` validates the request, then calls OpenRouter's chat completions endpoint.
- The model is one fixed constant, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned, in `netlify/shared/provider.ts`. The client cannot send a model, the page has no picker, and no environment variable changes it.
- `OPENROUTER_API_KEY` lives only in the function's environment on the server. The browser never receives it.
- Request checks are in `netlify/shared/request.ts`, the comparison parser in `netlify/shared/compare.ts` (the page imports it too). Stream handling is in `netlify/shared/vision-run.ts`. Reply checks and provider error mapping are in `netlify/shared/upstream.ts`.
- The body is measured in bytes before it is parsed, and anything over 6 MB is rejected. An image larger than 4 MB is rejected. The question is capped at 1,000 characters, and the page shows the count as you type. In Compare each image is capped at 2 MB. Modes, media types and browser origins are checked against allowlists.
- A rate limit allows 20 requests per minute per client address. It is kept in memory by each warm function instance.
- One 25-second deadline per request covers connecting to OpenRouter, reading the answer and the retry. The browser guards a stalled connection two ways: it gives up when no byte has arrived for 30 seconds, and after 60 seconds in all. Stop stays silent; it is not an error.
- `max_tokens` is always sent: 4,096 for Describe, Analyze and Question, 8,192 for Extract, 2,048 for Region and 3,072 for Compare. Reasoning is turned off. Usage is requested, so the response includes tokens and, when the provider reports it, cost.
- One automatic retry, only for a call that says nothing: if there is no response or first word within 9 seconds (about one and a half times a healthy call's time to first word), or the connection cannot be made, the server tries once more when at least 10 seconds of the budget are left. The trace shows "Retried once". Nothing is retried after words have arrived, after an HTTP error from the provider (401, 402, 403, 429, 5xx) or after Stop, so a billed call is never repeated.
- The provider's own error body is never shown. Failures map to plain sentences: rejected key or no credit, rate limited, did not answer in time, or could not be reached. An unexpected server error returns one generic message.

## Run locally

```
npm ci
npx netlify dev
```

`npx netlify dev` serves the page and the function together on port 8888. Set `OPENROUTER_API_KEY` in your shell or in the Netlify CLI environment. Only the name appears here. `npm run dev` serves the page alone on port 5173 and proxies `/api` to port 8888, so run `npx netlify dev` alongside it for analyses to work.

Checks:

```
npm test
npm run lint
npm run typecheck
npm run build
```

The tests stub the provider and the Commons API with `vi.stubGlobal`; the canvas crop is stubbed in node, and its geometry is tested as pure functions. They set no real key, never call OpenRouter and never call Wikimedia. The Commons parser tests use a reply cut to the real response shape.

## Known limits

- Model text is shown by a small parser (headings, lists, tables, code, bold, italic, inline code) that builds elements, never HTML.
- An analysis that runs longer than 25 seconds stops. The partial answer stays on screen and is marked incomplete. Long extractions are the most likely to hit this limit.
- Cancel stops the browser request at once. The server may still finish its provider call, and that call is still billed.
- The rate limit is per warm instance and held in memory. It is not a hard quota.
- Cost is the figure the provider reports for each call. The app does not calculate it.
- The "Parse and validate" step confirms that the reply is not empty or cut off. It does not confirm that the answer is correct.
- Recent analyses (up to 12) and the regions asked about the current picture are kept in page memory and lost on reload. Region answers are listed under the picture, not in Recent analyses.
- A box is a rectangle, drawn from corner to corner; it cannot be rotated. The model sees only the crop and a line about where it came from, so a question that needs the rest of the picture will be answered from the crop alone.
- Comparison images are scaled down to 2 MB, so fine print in a large photo can be lost; use Region to read it.
- The test suite stubs the provider and Commons. It checks code paths, not the model's answers.
- Commons search is only as good as its keyword match: a result can be off topic. Some results are dropped because they are not JPEG, PNG, WebP or GIF, or are over 4 MB.
