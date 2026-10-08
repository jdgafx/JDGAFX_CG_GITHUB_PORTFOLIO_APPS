# VisionLab

Live: https://jdgafx-app-08-vision-ai.netlify.app

VisionLab answers questions about one image. Choose a JPG, PNG, WebP or GIF up to 4 MB, pick a mode, and analyze it. Describe gives a full description of the scene. Analyze covers composition, colour, objects, visible text and image quality. Question answers one question you type. Extract pulls out text, numbers and tables in their original structure. The answer streams in as it arrives, and a run trace shows each step with its time, tokens and cost.

**What this showcases:** a multimodal call, one image and one prompt in, a streamed answer out, with the reply checked for completeness before it is marked done.

## The pipeline

Each run has three steps. The names match the trace exactly.

1. **Request checked.** The server checks the image type and size, the mode and the question. A failed check ends the run here, and the trace marks this step as failed.
2. **Model call.** The server sends the image and prompt to one vision model through OpenRouter and streams the reply back. The step shows the served model and the number of text chunks.
3. **Parse and validate.** The server checks that the reply is not empty, did not stop at the output limit, was not filtered, and was not written by a moderation model. This is a format check. It does not check whether the answer is correct.

The page shows the trace with each step's status and time. Below it, a readout strip shows total latency, prompt, completion and total tokens, the cost in USD as the provider reports it, and the served model. A value shows "not reported" when the provider does not send it.

## Architecture

- The browser posts the image and the request fields to `/api/ai`.
- The Netlify Function `netlify/functions/ai.ts` validates the request, then calls OpenRouter's chat completions endpoint.
- The model is one fixed constant, `~anthropic/claude-haiku-latest`, in `netlify/shared/provider.ts`. The client cannot send a model, the page has no picker, and no environment variable changes it.
- `OPENROUTER_API_KEY` lives only in the function's environment on the server. The browser never receives it.
- Request checks are in `netlify/shared/request.ts`. Stream handling is in `netlify/shared/vision-run.ts`. Reply checks and provider error mapping are in `netlify/shared/upstream.ts`.
- The body is measured in bytes before it is parsed, and anything over 6 MB is rejected. An image larger than 4 MB is rejected. The question is capped at 1,000 characters. Modes, media types and browser origins are checked against allowlists.
- A rate limit allows 20 requests per minute per client address. It is kept in memory by each warm function instance.
- One 25-second deadline per request covers both connecting to OpenRouter and reading the answer. The browser also waits up to 60 seconds, as a guard against a stalled connection.
- `max_tokens` is always sent: 4,096 for Describe, Analyze and Question, and 8,192 for Extract. Reasoning is turned off. Usage is requested, so the response includes tokens and, when the provider reports it, cost.
- There are no retries. Every model call is billed, so a failed run shows as failed, and the user runs it again.
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

The tests stub the provider with `vi.stubGlobal`. They set no real key and never call OpenRouter.

## Known limits

- An analysis that runs longer than 25 seconds stops. The partial answer stays on screen and is marked incomplete. Long extractions are the most likely to hit this limit.
- Cancel stops the browser request at once. The server may still finish its provider call, and that call is still billed.
- The rate limit is per warm instance and held in memory. It is not a hard quota.
- Cost is the figure the provider reports for each call. The app does not calculate it.
- The "Parse and validate" step confirms that the reply is not empty or cut off. It does not confirm that the answer is correct.
- Recent analyses are kept in page memory, up to 12, and are lost on reload.
- The test suite stubs the provider. It checks code paths, not the model's answers.
