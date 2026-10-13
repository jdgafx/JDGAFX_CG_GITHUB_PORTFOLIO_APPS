import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => (await import('../helpers/hooks')).reactStub)

import { useAnalysis } from '../../src/lib/useAnalysis'
import { recordedPicture, sameRequest } from '../../src/lib/useReplay'
import { installReplayShim, parseRecording, type ReplayShim } from '../../src/replay'
import { render, resetHooks } from '../helpers/hooks'
import { analysisRecording, CREDIT, RECORDED_TEXT } from '../helpers/recording'

// Node has no FileReader. This stand-in reads the File's bytes the same way the browser does.
class FakeFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(file: Blob): void {
    void file.arrayBuffer().then(buffer => {
      this.result = `data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`
      this.onload?.()
    })
  }
}

const realFetch = globalThis.fetch
let shim: ReplayShim | null = null
const hook = () => render(() => useAnalysis())

// The page, as App wires it: the recording's shim goes in, the recorded picture is put on the page, then the replayed run starts.
function startReplay(final: 'complete' | 'failed' = 'complete') {
  const recording = parseRecording(analysisRecording({}, final))!
  shim = installReplayShim(recording, { target: globalThis, origin: 'http://localhost', speed: 1, requestMatches: sameRequest })
  const picture = recordedPicture(recording)!
  hook().loadRecorded(picture.file, picture.credit)
  return hook().runReplay()
}

beforeEach(() => {
  resetHooks()
  vi.stubGlobal('FileReader', FakeFileReader)
})

afterEach(() => {
  shim?.stop()
  shim = null
  vi.unstubAllGlobals()
  globalThis.fetch = realFetch
})

describe('a replayed run through the page\'s own client', () => {
  it('shows the recorded answer, the recorded readout and the picture with its credit, as a replay', async () => {
    await startReplay()
    const page = hook()
    expect(page.status).toBe('complete')
    expect(page.result).toBe(RECORDED_TEXT)
    expect(page.summary?.servedModel).toBe('anthropic/claude-haiku-5.5')
    expect(page.summary?.totalMs).toBe(8400)
    expect(page.source).toEqual(CREDIT)
    expect(page.imageUrl).not.toBe('')
    expect(page.replay).toBe(true)
    expect(page.recorded).toBe(true)
    // The recorded picture was not fetched now: it sets no load time for the live-data chip.
    expect(page.loadedAt).toBeNull()
  })

  it('never enters the recent analyses', async () => {
    await startReplay()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(hook().gallery).toEqual([])
  })

  it('puts the original fetch back once every recorded reply is delivered', async () => {
    await startReplay()
    expect(shim?.active).toBe(false)
    expect(globalThis.fetch).toBe(realFetch)
  })
})

describe('after the replay, nothing recorded stays in what the visitor works with', () => {
  it('a picture of the visitor\'s own replaces the recording: no label, no recorded flag, no recorded answer', async () => {
    await startReplay()
    const own = new File(['mine'], 'mine.png', { type: 'image/png' })
    hook().chooseFile(own)
    const page = hook()
    expect(page.replay).toBe(false)
    expect(page.recorded).toBe(false)
    expect(page.result).toBe('')
    expect(page.summary).toBeNull()
    expect(page.status).toBe('idle')
    expect(page.source).toBeNull()
    expect(page.file?.name).toBe('mine.png')
  })

  it('a live run on the recorded picture is a live run: the label goes and the result is the server\'s', async () => {
    await startReplay()
    const live = vi.fn(async () => new Response('data: {"stage":"complete","result":"Live answer","servedModel":"m","totalMs":5}\n\ndata: [DONE]\n\n', { status: 200 }))
    vi.stubGlobal('fetch', live)
    await hook().run()
    const page = hook()
    expect(live).toHaveBeenCalledTimes(1)
    expect(page.replay).toBe(false)
    expect(page.result).toBe('Live answer')
    expect(page.gallery).toHaveLength(1)
  })

  it('changing the mode drops the recorded answer', async () => {
    await startReplay()
    hook().changeMode('analyze')
    const page = hook()
    expect(page.replay).toBe(false)
    expect(page.result).toBe('')
  })

  it('discarding the replay empties the page: picture, answer, readout and credit', async () => {
    await startReplay()
    hook().discardReplay()
    const page = hook()
    expect(page.file).toBeNull()
    expect(page.imageUrl).toBe('')
    expect(page.source).toBeNull()
    expect(page.result).toBe('')
    expect(page.summary).toBeNull()
    expect(page.steps).toEqual([])
    expect(page.status).toBe('idle')
    expect(page.replay).toBe(false)
    expect(page.recorded).toBe(false)
  })
})

describe('a replay that cannot be played through', () => {
  it('shows no failure and no half answer: the page goes back to the empty screen', async () => {
    await startReplay('failed')
    const page = hook()
    expect(page.status).toBe('idle')
    expect(page.notice).toBe('')
    expect(page.result).toBe('')
    expect(page.file).toBeNull()
    expect(page.replay).toBe(false)
  })

  it('stopped mid-run, shows nothing of the run that was still in flight', async () => {
    const running = startReplay()
    await new Promise(resolve => setTimeout(resolve, 25))
    shim?.stop()
    hook().discardReplay()
    await running
    const page = hook()
    expect(page.status).toBe('idle')
    expect(page.result).toBe('')
    expect(page.file).toBeNull()
    expect(page.summary).toBeNull()
  })

  it('shows nothing even when the discarded run still finishes, because the page no longer takes its result', async () => {
    const running = startReplay()
    // This fetch ignores the page's abort, so the recorded run reaches its end after the replay was discarded.
    const shimFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => shimFetch(input, { ...init, signal: undefined })) as typeof fetch
    await new Promise(resolve => setTimeout(resolve, 25))
    hook().discardReplay()
    await running
    const page = hook()
    expect(page.status).toBe('idle')
    expect(page.result).toBe('')
    expect(page.summary).toBeNull()
    expect(page.gallery).toHaveLength(0)
  })
})
