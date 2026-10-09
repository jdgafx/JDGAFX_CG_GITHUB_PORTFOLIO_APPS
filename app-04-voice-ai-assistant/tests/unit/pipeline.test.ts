import { describe, expect, it } from 'vitest'
import type { TraceStep } from '../../src/lib/api'
import { liveStep, pipelineView } from '../../src/lib/pipeline'

function step(name: string, status: TraceStep['status'], ms = 10): TraceStep {
  return { name, status, ms, detail: name }
}

// A voice question that reached a reply and was read aloud. "parse and validate" appears
// once in the transcribe trace and once in the chat trace, so position decides the stage.
const voiceRun: TraceStep[] = [
  step('prepare audio', 'ok', 4),
  step('speech to text', 'ok', 800),
  step('parse and validate', 'ok', 1),
  step('request built', 'ok', 2),
  step('model call', 'ok', 1500),
  step('parse and validate', 'ok', 1),
  step('speak reply', 'ok', 2100),
]

describe('pipelineView for a finished run', () => {
  it('marks all three stages done and both edges passed for a voice question', () => {
    const view = pipelineView('idle', voiceRun)
    expect(view.listen).toEqual({ state: 'ok', ms: 800 })
    expect(view.think).toEqual({ state: 'ok', ms: 1500 })
    expect(view.speak).toEqual({ state: 'ok', ms: 2100 })
    expect(view.transcriptPassed).toBe(true)
    expect(view.replyPassed).toBe(true)
  })

  it('fails Think on an empty reply and leaves Listen done', () => {
    const steps = [...voiceRun.slice(0, 5), step('parse and validate', 'failed', 1)]
    const view = pipelineView('idle', steps)
    expect(view.listen.state).toBe('ok')
    expect(view.think.state).toBe('failed')
    expect(view.replyPassed).toBe(false)
    expect(view.speak.state).toBe('notrun')
  })

  it('fails Listen when the transcribe parse fails, before any model step', () => {
    const steps = [step('prepare audio', 'ok', 4), step('speech to text', 'ok', 800), step('parse and validate', 'failed', 1)]
    const view = pipelineView('idle', steps)
    expect(view.listen.state).toBe('failed')
    expect(view.transcriptPassed).toBe(false)
    expect(view.think.state).toBe('notrun')
  })

  it('reads the browser transcript as a Listen pass after Deepgram fails', () => {
    const steps = [
      step('prepare audio', 'ok', 4),
      step('speech to text', 'failed', 300),
      step('browser speech recognition', 'ok', 0),
      ...voiceRun.slice(3),
    ]
    const view = pipelineView('idle', steps)
    expect(view.listen).toEqual({ state: 'ok', ms: 300 })
    expect(view.transcriptPassed).toBe(true)
    expect(view.think.state).toBe('ok')
  })

  it('fails Listen with no fallback and leaves Think and Speak not run', () => {
    const steps = [step('prepare audio', 'ok', 4), step('speech to text', 'failed', 300)]
    const view = pipelineView('idle', steps)
    expect(view.listen).toEqual({ state: 'failed', ms: 300 })
    expect(view.think.state).toBe('notrun')
    expect(view.speak.state).toBe('notrun')
  })

  it('fails Listen for a microphone error', () => {
    const view = pipelineView('idle', [step('start recording', 'failed', 0)])
    expect(view.listen.state).toBe('failed')
    expect(view.think.state).toBe('notrun')
  })

  it('treats a typed question as Listen skipped and passes the reply to Speak', () => {
    const typed = [
      step('request built', 'ok', 2),
      step('model call', 'ok', 1400),
      step('parse and validate', 'ok', 1),
      step('speak reply', 'ok', 900),
    ]
    const view = pipelineView('idle', typed)
    expect(view.listen.state).toBe('skipped')
    expect(view.listen.note).toBe('Not used for a typed question')
    expect(view.transcriptPassed).toBe(false)
    expect(view.think.state).toBe('ok')
    expect(view.replyPassed).toBe(true)
    expect(view.speak).toEqual({ state: 'ok', ms: 900 })
  })

  it('keeps Think done when a tool call failed but the model still answered', () => {
    const steps = [
      step('request built', 'ok', 2),
      step('model call', 'ok', 700),
      step('tool call', 'failed', 3000),
      step('model answer', 'ok', 800),
      step('parse and validate', 'ok', 1),
      step('speak reply', 'ok', 900),
    ]
    // 700 + 800 for the two model calls, plus the 3000 ms tool.
    expect(pipelineView('idle', steps).think).toEqual({ state: 'ok', ms: 4500 })
  })

  it('adds the two model calls and only the slowest of parallel tools to the Think time', () => {
    const steps = [
      step('request built', 'ok', 2),
      step('model call', 'ok', 1000),
      step('tool call', 'ok', 1200),
      step('tool call', 'ok', 1300),
      step('model answer', 'ok', 2000),
      step('speak reply', 'ok', 900),
    ]
    expect(pipelineView('idle', steps).think).toEqual({ state: 'ok', ms: 4300 })
  })

  it('still fails Think when the answer call after a tool failed', () => {
    const steps = [
      step('request built', 'ok', 2),
      step('model call', 'ok', 700),
      step('tool call', 'ok', 300),
      step('model answer', 'failed', 40),
    ]
    expect(pipelineView('idle', steps).think).toEqual({ state: 'failed', ms: 40 })
  })

  it('marks a cancelled model call as Think skipped and Speak not run', () => {
    const steps = [
      step('prepare audio', 'ok', 4),
      step('speech to text', 'ok', 700),
      step('request built', 'ok', 2),
      step('model call', 'skipped', 300),
    ]
    const view = pipelineView('idle', steps)
    expect(view.think).toEqual({ state: 'skipped', ms: 300 })
    expect(view.speak.state).toBe('notrun')
  })

  it('shows Speak skipped when this browser has no voice', () => {
    const view = pipelineView('idle', [...voiceRun.slice(0, 6), step('speak reply', 'skipped', 0)])
    expect(view.speak.state).toBe('skipped')
  })

  it('fails Think on a chat server error in a typed question, not Listen', () => {
    const view = pipelineView('idle', [step('server error', 'failed', 5)])
    expect(view.listen.state).toBe('skipped')
    expect(view.think).toEqual({ state: 'failed', ms: 5 })
    expect(view.speak.state).toBe('notrun')
  })

  it('fails Think, not Listen, when the chat server errors after a finished transcript', () => {
    const view = pipelineView('idle', [...voiceRun.slice(0, 3), step('server error', 'failed', 5)])
    expect(view.listen.state).toBe('ok')
    expect(view.transcriptPassed).toBe(true)
    expect(view.think).toEqual({ state: 'failed', ms: 5 })
  })

  it('fails Listen when the transcribe server errors before any transcript', () => {
    const view = pipelineView('idle', [step('prepare audio', 'ok', 4), step('server error', 'failed', 5)])
    expect(view.listen).toEqual({ state: 'failed', ms: 5 })
    expect(view.think.state).toBe('notrun')
  })

  it('forgives a failed transcribe server error when the browser transcript stood in', () => {
    const steps = [
      step('prepare audio', 'ok', 4),
      step('server error', 'failed', 5),
      step('browser speech recognition', 'ok', 0),
      ...voiceRun.slice(3),
    ]
    const view = pipelineView('idle', steps)
    expect(view.listen.state).toBe('ok')
    expect(view.think.state).toBe('ok')
  })
})

describe('pipelineView while a run is in progress', () => {
  it('lights Listen while recording and leaves the other stages waiting', () => {
    const view = pipelineView('recording', null)
    expect(view.listen.state).toBe('running')
    expect(view.think.state).toBe('waiting')
    expect(view.speak.state).toBe('waiting')
  })

  it('lights Listen while transcribing', () => {
    const view = pipelineView('transcribing', [step('prepare audio', 'ok', 4)])
    expect(view.listen.state).toBe('running')
    expect(view.think.state).toBe('waiting')
  })

  it('shows Listen done and Think running while the model answers', () => {
    const view = pipelineView('thinking', voiceRun.slice(0, 3))
    expect(view.listen.state).toBe('ok')
    expect(view.transcriptPassed).toBe(true)
    expect(view.think.state).toBe('running')
    expect(view.speak.state).toBe('waiting')
  })

  it('shows a typed question with Listen skipped while the model answers', () => {
    const view = pipelineView('thinking', [])
    expect(view.listen.state).toBe('skipped')
    expect(view.think.state).toBe('running')
  })

  it('shows Speak running while the reply is read aloud', () => {
    const view = pipelineView('speaking', voiceRun.slice(0, 6))
    expect(view.speak.state).toBe('running')
    expect(view.think.state).toBe('ok')
  })

  it('shows every stage waiting before any question', () => {
    expect(pipelineView('idle', null)).toEqual({
      listen: { state: 'waiting' },
      think: { state: 'waiting' },
      speak: { state: 'waiting' },
      transcriptPassed: false,
      replyPassed: false,
    })
  })
})

describe('liveStep', () => {
  it('names the running step for each phase', () => {
    expect(liveStep('recording', null)?.name).toBe('record audio')
    expect(liveStep('transcribing', [])?.name).toBe('prepare audio')
    expect(liveStep('transcribing', [step('prepare audio', 'ok')])?.name).toBe('speech to text')
    expect(liveStep('thinking', [])?.name).toBe('model call')
    expect(liveStep('speaking', voiceRun)?.name).toBe('speak reply')
    expect(liveStep('idle', voiceRun)).toBeNull()
  })
})
