import type { CommonsImage } from '../../src/lib/commons'

// A stored run of the built-in example as the recorder would write it: one /api/ai exchange with the picture in its request.
export const PICTURE_BYTES = 'fake-jpeg-bytes'
export const PICTURE_B64 = Buffer.from(PICTURE_BYTES).toString('base64')

export const CREDIT: CommonsImage = {
  title: 'Street scene',
  fileName: 'Street_scene.jpg',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Street_scene.jpg',
  thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Street_scene.jpg/1280px-Street_scene.jpg',
  mime: 'image/jpeg',
  width: 1280,
  height: 853,
  author: 'A. Photographer',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0',
}

export const RECORDED_TEXT = 'A busy street at dusk with people crossing.'

function frame(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

export function requestBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ image: PICTURE_B64, mediaType: 'image/jpeg', mode: 'describe', credit: CREDIT, ...over })
}

/** The frames the server sent, in order, with the final one either complete or failed. */
export function recordedFrames(final: 'complete' | 'failed' = 'complete'): string[] {
  const modelStep = { name: 'Model call', status: 'ok', ms: 30, detail: 'anthropic/claude-haiku-5.5, 2 text chunks', tokens: 900, cost: 0.0004 }
  return [
    frame({ stage: 'step', step: { name: 'Request checked', status: 'ok', ms: 1, detail: 'Describe, image/jpeg, about 1 KB' } }),
    frame({ text: 'A busy street ' }),
    frame({ text: 'at dusk with people crossing.' }),
    final === 'complete'
      ? frame({
          stage: 'complete',
          result: RECORDED_TEXT,
          trace: [{ name: 'Request checked', status: 'ok', ms: 1, detail: 'Describe, image/jpeg, about 1 KB' }, modelStep],
          usage: { prompt_tokens: 800, completion_tokens: 100, total_tokens: 900, cost: 0.0004 },
          servedModel: 'anthropic/claude-haiku-5.5',
          newestModel: 'anthropic/claude-haiku-5.5',
          modelCheck: 'match',
          totalMs: 8400,
        })
      : frame({ stage: 'failed', error: 'The AI provider did not answer in time.', trace: [] }),
    'data: [DONE]\n\n',
  ]
}

export function analysisRecording(over: Record<string, unknown> = {}, final: 'complete' | 'failed' = 'complete') {
  const chunks = recordedFrames(final).map((text, i) => ({ t: 10 + i * 10, text }))
  return {
    version: 1,
    app: 'app-08-vision-ai',
    url: 'https://example.netlify.app/',
    recorded_at: new Date().toISOString(),
    reported: { model: 'anthropic/claude-haiku-5.5', model_role: 'described by', cost_usd: 0.0004, cost_scope: 'model call' },
    exchanges: [
      {
        method: 'POST',
        path: '/api/ai',
        request_body: requestBody() as string | null,
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        t_start: 0,
        t_headers: 5,
        t_end: 70,
        chunks,
      },
    ],
    ...over,
  }
}
