import { describe, expect, it } from 'vitest'
import { ttfa } from '../../src/lib/ttfa'

describe('ttfa', () => {
  it('splits a typed question with a tool lookup into parts that add up to the total', () => {
    const out = ttfa({
      origin: 1000,
      toolsStartAt: 2300,
      toolsEndAt: 2850,
      firstTokenAt: 3900,
      firstSentenceAt: 3920,
      speechStartAt: 4010,
    })
    expect(out.parts).toEqual({ transcribe: undefined, tools: 550, firstToken: 2900 - 550, firstSentence: 20, speechStart: 90 })
    expect(out.total).toBe(3010)
    const sum = (out.parts.tools ?? 0) + (out.parts.firstToken ?? 0) + (out.parts.firstSentence ?? 0) + (out.parts.speechStart ?? 0)
    expect(sum).toBe(out.total)
    expect(out.toFirstSentence).toBe(2920)
  })

  it('counts the transcript as its own part for a voice question and measures the chat from the transcript', () => {
    const out = ttfa({ origin: 0, transcriptAt: 900, firstTokenAt: 2100, firstSentenceAt: 2100, speechStartAt: 2150 })
    expect(out.parts).toMatchObject({ transcribe: 900, firstToken: 1200, firstSentence: 0, speechStart: 50 })
    expect(out.total).toBe(2150)
  })

  it('has no total until the voice has started, and still reports the first sentence (a device with no voice)', () => {
    const out = ttfa({ origin: 0, firstTokenAt: 1500, firstSentenceAt: 1600 })
    expect(out.total).toBeUndefined()
    expect(out.parts.speechStart).toBeUndefined()
    expect(out.toFirstSentence).toBe(1600)
  })

  it('leaves the tool lookups out when the model speaks first, because they ran while the voice talked', () => {
    const out = ttfa({ origin: 0, firstTokenAt: 1100, toolsStartAt: 1400, toolsEndAt: 2300, firstSentenceAt: 1350, speechStartAt: 1450 })
    expect(out.parts.tools).toBeUndefined()
    expect(out.parts).toMatchObject({ firstToken: 1100, firstSentence: 250, speechStart: 100 })
    expect(out.total).toBe(1450)
  })

  it('never reports a negative part', () => {
    expect(ttfa({ origin: 100, firstTokenAt: 90 }).parts.firstToken).toBe(0)
  })
})
