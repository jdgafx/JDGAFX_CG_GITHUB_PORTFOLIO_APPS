# VoxAI

VoxAI is a streaming voice assistant. You ask a question by voice or by typing. The browser records up to 90 seconds of speech, Deepgram turns it into words, and OpenRouter writes the reply, which streams to the page over server-sent events. The browser starts speaking at the first complete sentence while the rest is still arriving, and the page highlights the sentence being spoken. A text box covers the case with no microphone.

The chat model has two live tools, and calls them on the server when a question needs them. `weather` looks up the current weather and today's high and low for a named place on Open-Meteo. `wikipedia_summary` reads the introduction of an English Wikipedia article. A question such as "What's the weather in Lisbon right now?" is answered from the live reading, not from the model's memory. Each tool call appears in the run trace, before the answer it feeds, with the call, its time and a link to the request the data came from. A weather answer also shows the Open-Meteo reading time it used.

What this showcases: a streaming voice loop with a measured **time to first audio**: from the end of speech (or from Ask, for a typed question) to the moment the browser's voice starts the first sentence. The readout shows it with its parts: transcribe, tools (when they ran before the first word), first token, first sentence, speech start.

On a desktop screen the controls sit on the left: record a question, type one or fill the box from an example, and one Stop that ends the stream and the voice together. The right side shows the answer, the time-to-first-audio readout, the three stages (Listen, Think, Speak) and the run trace. Under 1000 pixels the columns stack, and a finished run scrolls its answer into view.

## Streaming and time to first audio

- `POST /api/ai` answers as server-sent events: `step` (each trace step, sent the moment it finishes, so tool calls reach the page before the answer), `delta` (a piece of the answer), then `done` or `error`, then `[DONE]`. Request validation errors still answer as plain JSON before any stream starts.
- The server streams OpenRouter's reply (`stream: true`) and forwards text as it arrives. Tool-call arguments arrive in fragments and are assembled by index. The model is told to say one short sentence ("Let me check the weather in Lisbon.") before it calls a tool, so the voice has something to say while the lookup and the second model call run. That sentence is spoken first and is part of the answer.
- `src/lib/sentences.ts` cuts the stream into sentences (no split inside "16.8", "Dr." or "J. R. R."), and a sentence that ends the text so far is released after 250 ms of quiet, or when the model goes off to call a tool. `src/lib/speechQueue.ts` hands each sentence to `speechSynthesis` in order, reports which one is being spoken (the highlight), the moment the first one starts (the clock stops there), and cancels everything on Stop. A fake `speechSynthesis` drives its unit tests.
- Time to first audio is measured in the browser with `performance.now()`. The parts add up to the headline: transcribe (end of speech to transcript, encoding and upload included), tools, first token, first sentence, speech start. Tool lookups count only when they finished before the first word.
- Stop aborts the fetch. The server sees the closed connection and aborts the OpenRouter call and any tool in flight, and the speech queue is cancelled in the same handler. If the answer had already finished, Stop only silences the voice.
- Reliability: the server sends a `: ping` comment every 10 s. Each model call has a 6 s first-byte limit; if the provider says nothing in that time (or the connection drops) the call is retried once, noted in the trace as "retried once", and never after any text has arrived. The browser watches the stream: nothing for 12 s before the first byte retries the request once, then no byte for 30 s ends the reply with a plain message and keeps what had arrived, and 60 s is the overall cap. Stop is never reported as a stall.
- With no voice installed (most headless browsers, some Linux desktops) the text still streams, a note says the reply is text only, and the headline reads "Time to first sentence", because there is no audio to time. It is never an error.

### Measured (2026-10-09, real model, Deepgram, Open-Meteo and Wikipedia)

Headless Chromium has no voices (`speechSynthesis.getVoices()` is empty and every utterance fails), so the voice's own start-up could not be timed. The figures are **to the first sentence ready to be spoken**, read from the app's own readout; the browser voice adds its start time (Speech start) on top.

| Run | n | p50 | p95 | Notes |
|---|---|---|---|---|
| Typed question, Ask to first sentence | 10 | 1,336 ms | 1,403 ms | 5 weather, 4 Wikipedia, 1 plain; min 1,172, max 1,403 |
| Typed question, first token | 10 | 1,142 ms | 1,351 ms | |
| Spoken question (recorded WAV of a TTS voice through Chromium's fake microphone), end of speech to first sentence | 3 | 2,434 ms | 2,466 ms | transcribe 1,057, 645 and 592 ms; with only 3 runs the p95 is the maximum |
| Typed, first sentence of the answer proper (after the tool lookup), 9 tool questions, measured on the stream | 9 | 3,122 ms | 3,652 ms | the spoken "Let me check" sentence at about 1.3 s covers this wait |

Without the "Let me check" sentence the first sentence of a tool question arrived at about 3.4 s (p50 over the same ten questions before the prompt change). Haiku sends its text in bursts, so first token and first sentence are nearly the same instant for a plain question. Every answer's weather numbers and Wikipedia facts were compared with the live source: see the phase C report.


## Weather reading time

Each weather answer shows the Open-Meteo reading it used: the local time of the reading slot, the refresh interval and when the server fetched it. Open-Meteo blends several weather models and republishes them in runs, and the server that answers a request can hold a slightly newer or older run than the one this app read. The source link in the trace can therefore show numbers that differ by a few tenths of a degree, and more for humidity and wind. The reading time says which slot the answer used.

## What a question does

These are the step names the run trace shows, in the order a voice question runs.

- **prepare audio** (browser): decodes the recording and re-encodes it as 16 kHz mono WAV. A recording with no speech energy is not sent.
- **audio received** (server): checks the body, the audio field, the format, and the size.
- **speech to text** (server): sends the clip to Deepgram `nova-3`. A silent WAV is skipped, and Deepgram is not called.
- **parse and validate** (server): removes surrounding quotes, a "Transcript:" label, and bracketed output such as "[no speech]".
- **silence check** (browser): drops filler phrases such as "Thank you." so they do not become a question.
- **browser speech recognition** (browser): runs only when Deepgram fails and the browser offers recognition. Its transcript is used, and a notice says so.
- **request built** (server): counts the earlier messages and the characters being sent.
- **model call** (server): one streamed OpenRouter request with a token cap, usage reporting, reasoning turned off, and the two tools offered. It retries once when nothing was heard from the provider for 6 seconds, the connection dropped, or the reply was empty, and only if at least 8 seconds of the run budget remain. It reports the served model, tokens, cost and the time to the first words. When the model asks for a tool, the detail says which.
- **tool call** (server): one step for each tool the model asked for, up to three, run in parallel. It shows the call, such as `weather("Lisbon")`, its own time, a one-line result, and a source link. A tool that fails or times out is marked Failed, and the model is told so in plain words.
- **model answer** (server): a second streamed request that carries the tool results and writes the reply. It is sent with `tool_choice` set to `none`, so a question gets at most one round of tool calls. The step reports its own tokens and cost, and the run totals add both model calls.
- **parse and validate** (server): refuses an empty reply and a safety-label reply.
- **speak reply** (browser): reads the reply aloud, sentence by sentence. It is marked skipped when the browser has no voice installed or when you pressed Stop.

A typed question runs request built, model call, parse and validate, and speak reply. A browser retry adds a **connection** step. A question that uses a tool adds the tool call and model answer steps after the model call. A microphone or recorder failure gets its own Last run card with one failed step: **start recording** or **record audio**. An unexpected server failure is recorded as **server error**.

The trace shows each step's status (Done, Failed or Skipped), its time, its token count and a bar for its share of the run. The answer card shows the server time, tokens and cost in USD, and the served model. A value the provider did not report is left out, never guessed.

## Architecture

- The browser (React and Vite) posts audio to `/api/transcribe` and text to `/api/ai`.
- Each path is a Netlify Function in `netlify/functions/`. The functions hold the keys, so the browser never sees one.
- `transcribe.ts` calls Deepgram with the fixed model `nova-3`. Its key is `DEEPGRAM_API_KEY`.
- `ai.ts` calls OpenRouter with one fixed model, Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`), pinned. Its key is `OPENROUTER_API_KEY`. That model supports tool calling on OpenRouter, which was checked against OpenRouter's live model list and with real calls.
- `tools.ts` holds the two tools. Neither needs a key.
- **Fixed model rule:** the chat model is one constant in `netlify/shared/provider.ts`. There is no model picker. The browser cannot choose a model, and any model name it sends is ignored. The reply reports the model OpenRouter served.
- `netlify/shared/` holds the shared server code. `http.ts` has the origin allow-list, the method check, the rate limit, the body limits, and the plain error copy. `provider.ts` has the model call, its retry and the tool round, `stream.ts` the streamed OpenRouter request and its three clocks, `sse.ts` the event parser shared with the browser. `tools.ts` has the tool definitions and the two lookups. `trace.ts` times each step.
- Validation on each function: method (405), origin (403), JSON (400), body size from the declared and the measured length (400), each field's type and limit (400), history shape (400), audio format from a fixed list (400), base64 shape (400), and audio size (400). Every 400 carries a plain-language `error` string.
- Tool calls: the model supplies the arguments, so each one is checked. `place` and `topic` must be text of 1 to 80 characters with no control characters. A tool name that is not offered is refused. Each lookup gets 3 seconds, or the time left in the run if that is less, through `AbortSignal.timeout`. The weather lookup is a geocoding request, then a forecast request. The Wikipedia lookup asks for the article summary by title, and falls back to a full-text search when no article has that title. The summary is cut to 600 characters, and a disambiguation page is flagged to the model. Wikimedia requests carry a descriptive `User-Agent`. A failure, a timeout, or an empty result goes back to the model as a sentence such as "The weather service did not answer", never as a value.
- Timeouts: every provider call uses the time left in one run budget of 25 seconds. A retry and the tool round share that budget and never extend it. The browser's watchdog is described above.
- Errors: a failed call returns `{ error, trace }`. Provider error text goes to the function log and never to the browser. A 401 or 402 reads "rejected the key or is out of credit". A 429 reads "Rate limited, try again in a minute". A 5xx or a timeout reads "did not answer in time". A dropped connection reads "could not be reached". When the browser's own request fails, it reads "Could not reach the server. Check your connection and try again."
- Rate limit: 20 requests per minute per client address, per warm function instance. It is a cost guard, not a hard quota.
- Retries: one per model call, only before any text has been sent. Speech-to-text is never retried.

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

- `npm test` runs the unit tests and the server smoke tests. Streaming tests replay OpenRouter streams recorded from the real service (`tests/fixtures/`). They replace `fetch` with a stub, so they never reach a provider. The tool tests answer Open-Meteo and Wikipedia requests with replies recorded in the same shape as the live ones, and check the parsed values, the units, the 3 second timeout, the 404 to search fallback, and the refusal of bad arguments. The tool round tests check that the answer call carries `tool_choice: none` and a tool message for each call, and that a tool request is not retried as an empty reply.
- `npm run lint` runs ESLint with zero warnings allowed.
- `npm run typecheck` runs TypeScript in strict mode for the app, the functions, and the tests.
- `npm run build` typechecks and builds the static site into `dist/`.

## Live site

https://jdgafx-app-04-voice-ai-assistant.netlify.app

## Known limits

- Stop closes the stream, which aborts the model call, but the provider may still bill the tokens already generated.
- Time to first audio cannot be measured where there is no voice. It was measured here in headless Chromium, which has none, so the figures above are to the first sentence ready; the browser's voice engine adds its own start-up time on top (speech start in the readout) and that is not in them.
- Haiku streams in bursts, not word by word: the whole first sentence usually arrives in one piece, so the voice cannot start earlier than the model's first piece. The tool path is slower because a tool round needs a second model call; the spoken "Let me check" sentence hides most of that wait, but the answer itself follows only after the lookup.
- Retries: one per model call, before any text has gone out.
- Tools: one round per question, up to three calls. The model cannot chain a second lookup from the first result. Tool results are not kept in the conversation history, so a follow-up question sends the earlier replies only.
- The tool definitions add about 700 prompt tokens to each model call, so a question that uses a tool costs about two and a half times a plain one. The Last run card shows the real figures.
- Open-Meteo weather is a model forecast for the point the geocoder finds, not a station reading. Open-Meteo's free service is for non-commercial use.
- Wikipedia lookups use the English edition only.
- The rate limit is per warm function instance and is best effort.
- The microphone path was exercised with Chromium's fake device playing a recorded WAV of a spoken question. A real microphone and real speakers need a manual check.
- The browser recognition fallback runs only where the browser provides SpeechRecognition. It has not been tested in any browser.
- Read-aloud uses the voices the browser has installed. With no voice, the reply shows as text only, with a note.
- The reading time in a weather answer is the time of the Open-Meteo slot the server read; the source link can show a slightly different run (see Weather reading time).
- Cost is what OpenRouter reports. Speech-to-text cost is not shown.
- The served model is what OpenRouter reports for the pinned model. It should match the request.
- A provider 5xx shows the same wording as a timeout, "did not answer in time".
- Provider error bodies are written to the function log, which may contain account detail. The browser never receives them.
- The functions keep no records. The rate limiter holds client addresses in memory for one window only. Deepgram and OpenRouter handle the clips and text under their own terms.
