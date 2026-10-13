import { describe, expect, it } from 'vitest'
import { chat } from '../../src/lib/chatStream'
import { IDLE_RUN, runReducer, type RunAction } from '../../src/lib/run'
import { recordedQuestion, replayDisabled } from '../../src/lib/useReplay'
import { installReplayShim, parseRecording, type Recording } from '../../src/replay'

const QUESTION = "What's the weather in Lisbon right now?"
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

function recording(history: unknown[] = []): Recording {
  const body = JSON.stringify({ message: QUESTION, history })
  const raw = {
    version: 1,
    app: 'app-04-voice-ai-assistant',
    url: 'https://example.netlify.app/',
    recorded_at: new Date().toISOString(),
    reported: { model: 'anthropic/test-model', model_role: 'answered by', cost_usd: 0.0004, cost_scope: 'whole run' },
    exchanges: [
      {
        method: 'POST',
        path: '/api/ai',
        request_body: body,
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        t_start: 0,
        t_headers: 10,
        t_end: 60,
        chunks: [
          { t: 20, text: frame({ type: 'step', step: { name: 'request built', status: 'ok', ms: 1, detail: 'packed' } }) },
          { t: 30, text: frame({ type: 'delta', text: 'It is 21.9 degrees. ' }) },
          { t: 40, text: frame({ type: 'delta', text: 'Clear skies.' }) },
          { t: 50, text: frame({ type: 'done', result: 'It is 21.9 degrees. Clear skies.', model: 'anthropic/test-model', totalMs: 1200 }) },
        ],
      },
    ],
  }
  const parsed = parseRecording(raw)
  if (!parsed) throw new Error('fixture is not a valid recording')
  return parsed
}

describe('replay of the example', () => {
  it('reads the question a recording answered, and refuses a follow-up with earlier turns', () => {
    expect(recordedQuestion(recording())).toBe(QUESTION)
    expect(recordedQuestion(recording([{ role: 'user', content: 'hi' }]))).toBeNull()
  })

  it('is switched off by ?replay=off only', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
  })

  it('plays through the real chat client with fetch answered from the recording', async () => {
    const steps: string[] = []
    let text = ''
    const real = globalThis.fetch
    let network = 0
    globalThis.fetch = (() => {
      network += 1
      return Promise.reject(new Error('the replay must not reach the network'))
    }) as typeof fetch
    const shim = installReplayShim(recording(), { target: globalThis, origin: 'http://localhost', speed: 20 })
    try {
      const done = await chat(QUESTION, [], { onStep: s => steps.push(s.name), onDelta: d => (text += d), onRetry: () => undefined })
      expect(text).toBe('It is 21.9 degrees. Clear skies.')
      expect(done.model).toBe('anthropic/test-model')
      expect(steps).toEqual(['request built'])
      expect(network).toBe(0)
    } finally {
      shim.stop()
      globalThis.fetch = real
    }
  })
})

describe('a replay run', () => {
  const start = { type: 'start', id: 1, via: 'text', question: QUESTION, now: 0 } as const

  it('is marked, and says it is text only rather than blaming the browser', () => {
    const actions: RunAction[] = [{ ...start, replay: true }, { type: 'text', sentences: ['Hello.'], rest: '', now: 5 }, { type: 'no-voice', now: 6 }]
    const run = actions.reduce(runReducer, IDLE_RUN)
    expect(run.replay).toBe(true)
    expect(run.voiceNote).toBe('A replay is text only: it never speaks.')
  })

  it('a live run started after it is not marked', () => {
    const replayed = runReducer(IDLE_RUN, { ...start, replay: true })
    expect(runReducer(replayed, start).replay).toBeUndefined()
  })
})
