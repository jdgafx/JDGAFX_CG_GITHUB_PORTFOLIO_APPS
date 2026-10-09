# VoxAI

VoxAI is a voice assistant. You ask a question by voice or by typing, and it answers in text and aloud. The browser records up to 90 seconds of speech by default, Deepgram turns the speech into words, and OpenRouter writes the reply. The browser reads the reply aloud with its own speech synthesis. A text box covers the case with no microphone. The Last run card lists each step with its timing, token counts, cost, and the model that answered.

The chat model has two live tools, and calls them on the server when a question needs them. `weather` looks up the current weather and today's high and low for a named place on Open-Meteo. `wikipedia_summary` reads the introduction of an English Wikipedia article. A question such as "What's the weather in Lisbon right now?" is answered from the live reading, not from the model's memory. Each tool call appears in the Last run card with the call, its time, and a link to the page or API request the data came from.

What this showcases: a voice loop, speech to text on the server, a chat model that calls live public data, and browser speech back, with each step timed.

On a desktop screen the controls sit on the left: record a question, type one or fill the box from an example, stop the reply, or clear the conversation. Three of the four examples use the live tools, such as "What's the weather in Lisbon right now?" and "Who was Ada Lovelace?". The right side shows the three stages, Listen (Deepgram), Think (the chat model), and Speak (the browser voice). Below them are the conversation, with a live waveform while recording, and the Last run card. Under 1000 pixels the two columns stack, with the controls first.

## What a question does

These are the step names the Last run card shows, in the order a voice question runs.

- **prepare audio** (browser): decodes the recording and re-encodes it as 16 kHz mono WAV. A recording with no speech energy is not sent.
- **audio received** (server): checks the body, the audio field, the format, and the size.
- **speech to text** (server): sends the clip to Deepgram `nova-3`. A silent WAV is skipped, and Deepgram is not called.
- **parse and validate** (server): removes surrounding quotes, a "Transcript:" label, and bracketed output such as "[no speech]".
- **silence check** (browser): drops filler phrases such as "Thank you." so they do not become a question.
- **browser speech recognition** (browser): runs only when Deepgram fails and the browser offers recognition. Its transcript is used, and a notice says so.
- **request built** (server): counts the earlier messages and the characters being sent.
- **model call** (server): one OpenRouter request with a token cap, usage reporting, reasoning turned off, and the two tools offered. It retries once only when the reply is empty and at least 8 seconds of the run budget remain. It reports the served model, tokens, and cost. When the model asks for a tool, the detail says which.
- **tool call** (server): one step for each tool the model asked for, up to three, run in parallel. It shows the call, such as `weather("Lisbon")`, its own time, a one-line result, and a source link. A tool that fails or times out is marked Failed, and the model is told so in plain words.
- **model answer** (server): a second request that carries the tool results and writes the reply. It is sent with `tool_choice` set to `none`, so a question gets at most one round of tool calls. The step reports its own tokens and cost, and the run totals add both model calls.
- **parse and validate** (server): refuses an empty reply and a safety-label reply.
- **speak reply** (browser): reads the reply aloud. It is marked skipped when the browser has no voice installed.

A typed question runs request built, model call, parse and validate, and speak reply. A question that uses a tool adds the tool call and model answer steps after the model call. A microphone or recorder failure gets its own Last run card with one failed step: **start recording** or **record audio**. An unexpected server failure is recorded as **server error**.

The Last run card shows each step's status (Done, Failed, or Skipped), its time, and its token count. It also shows total latency, prompt, completion and total tokens, cost in USD, and the served model. A value the provider did not report shows as "not reported", never as a guess.

## Architecture

- The browser (React and Vite) posts audio to `/api/transcribe` and text to `/api/ai`.
- Each path is a Netlify Function in `netlify/functions/`. The functions hold the keys, so the browser never sees one.
- `transcribe.ts` calls Deepgram with the fixed model `nova-3`. Its key is `DEEPGRAM_API_KEY`.
- `ai.ts` calls OpenRouter with one fixed model, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned. Its key is `OPENROUTER_API_KEY`. That model supports tool calling on OpenRouter, which was checked against OpenRouter's live model list and with real calls.
- `tools.ts` holds the two tools. Neither needs a key.
- **Fixed model rule:** the chat model is one constant in `netlify/shared/provider.ts`. There is no model picker. The browser cannot choose a model, and any model name it sends is ignored. The reply reports the model OpenRouter served.
- `netlify/shared/` holds the shared server code. `http.ts` has the origin allow-list, the method check, the rate limit, the body limits, and the plain error copy. `provider.ts` has the OpenRouter call, its retry, and the tool round. `tools.ts` has the tool definitions and the two lookups. `trace.ts` times each step.
- Validation on each function: method (405), origin (403), JSON (400), body size from the declared and the measured length (400), each field's type and limit (400), history shape (400), audio format from a fixed list (400), base64 shape (400), and audio size (400). Every 400 carries a plain-language `error` string.
- Tool calls: the model supplies the arguments, so each one is checked. `place` and `topic` must be text of 1 to 80 characters with no control characters. A tool name that is not offered is refused. Each lookup gets 3 seconds, or the time left in the run if that is less, through `AbortSignal.timeout`. The weather lookup is a geocoding request, then a forecast request. The Wikipedia lookup asks for the article summary by title, and falls back to a full-text search when no article has that title. The summary is cut to 600 characters, and a disambiguation page is flagged to the model. Wikimedia requests carry a descriptive `User-Agent`. A failure, a timeout, or an empty result goes back to the model as a sentence such as "The weather service did not answer", never as a value.
- Timeouts: every provider call uses the time left in one run budget of 25 seconds. A retry and the tool round share that budget and never extend it. The browser gives up on a call after 30 seconds.
- Errors: a failed call returns `{ error, trace }`. Provider error text goes to the function log and never to the browser. A 401 or 402 reads "rejected the key or is out of credit". A 429 reads "Rate limited, try again in a minute". A 5xx or a timeout reads "did not answer in time". A dropped connection reads "could not be reached". When the browser's own request fails, it reads "Could not reach the server. Check your connection and try again."
- Rate limit: 20 requests per minute per client address, per warm function instance. It is a cost guard, not a hard quota.
- Retries: one retry for an empty chat reply, on each model call. A tool request is not an empty reply. Speech-to-text is never retried.
- Chat replies arrive as one JSON response. The app does not stream.

## Environment variables

Names only. Set the keys in Netlify or in the Netlify CLI environment. Do not commit them. Every limit is a constant in the code: 1024 output tokens, 5000 characters a message, 20 earlier messages, a 25 second run budget, 4.5 MiB of audio, 20 requests a minute per client, and 90 seconds of recording.

| Name | Where | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | server | Chat replies. Required. |
| `DEEPGRAM_API_KEY` | server | Speech to text. Without it, voice questions fall back to browser recognition where available. |
| `ALLOWED_ORIGINS` | server | Extra browser origins that may call the functions, comma separated. |

Netlify sets `URL`, `DEPLOY_PRIME_URL`, and `DEPLOY_URL` itself. The origin check reads them.

## Run locally

1. Run `npm ci`.
2. Run `npm run dev` to serve the UI on port 5173. Its `/api` calls go to port 8888, so they fail unless the functions run there.
3. Run `npx netlify dev` to serve the UI and the functions together on port 8888. It needs `OPENROUTER_API_KEY` and `DEEPGRAM_API_KEY` in its environment.

Checks:

- `npm test` runs the unit tests and the server smoke tests. They replace `fetch` with a stub, so they never reach a provider. The tool tests answer Open-Meteo and Wikipedia requests with replies recorded in the same shape as the live ones, and check the parsed values, the units, the 3 second timeout, the 404 to search fallback, and the refusal of bad arguments. The tool round tests check that the answer call carries `tool_choice: none` and a tool message for each call, and that a tool request is not retried as an empty reply.
- `npm run lint` runs ESLint with zero warnings allowed.
- `npm run typecheck` runs TypeScript in strict mode for the app, the functions, and the tests.
- `npm run build` typechecks and builds the static site into `dist/`.

## Live site

https://jdgafx-app-04-voice-ai-assistant.netlify.app

## Known limits

- Cancel aborts the browser request. The server call still finishes, and the provider still bills it.
- The app does not stream. Each reply arrives whole, after the model finishes.
- Retries: one for each model call, and only for an empty chat reply.
- Tools: one round per question, up to three calls. The model cannot chain a second lookup from the first result. Tool results are not kept in the conversation history, so a follow-up question sends the earlier replies only.
- The tool definitions add about 700 prompt tokens to each model call, so a question that uses a tool costs about two and a half times a plain one. The Last run card shows the real figures.
- Open-Meteo weather is a model forecast for the point the geocoder finds, not a station reading. Open-Meteo's free service is for non-commercial use.
- Wikipedia lookups use the English edition only.
- The rate limit is per warm function instance and is best effort.
- The microphone path is not verified here. The test environment has no microphone, so capture, the waveform, and read-aloud need a manual check on a machine with a microphone and speakers.
- The browser recognition fallback runs only where the browser provides SpeechRecognition. It has not been tested in any browser.
- Read-aloud uses the voices the browser has installed. With no voice, the reply shows as text only.
- Cost is what OpenRouter reports. Speech-to-text cost is not shown.
- The served model is what OpenRouter reports for the pinned model. It should match the request.
- A provider 5xx shows the same wording as a timeout, "did not answer in time".
- Provider error bodies are written to the function log, which may contain account detail. The browser never receives them.
- The functions keep no records. The rate limiter holds client addresses in memory for one window only. Deepgram and OpenRouter handle the clips and text under their own terms.
