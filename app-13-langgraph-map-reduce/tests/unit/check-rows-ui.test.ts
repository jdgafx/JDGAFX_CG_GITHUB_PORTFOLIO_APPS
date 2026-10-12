import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MODEL } from '../../netlify/shared/models'
import type { ChatFn, ChatReply } from '../../netlify/shared/openrouter'
import { ReadoutStrip } from '../../src/components/ReadoutStrip'
import { TracePanel } from '../../src/components/TracePanel'
import { pathSteps } from '../../src/lib/status'
import { applyFrame, initialView, type RunView } from '../../src/lib/view'
import { withAttribution } from '../helpers/attribute'
import { roleOf } from '../helpers/roles'
import { runSplit } from '../helpers/split'

const paragraph = (n: number): string => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
const THREE = [1, 2, 3].map(paragraph).join('\n')
const reply = (text: string): ChatReply => ({ text, finishReason: 'stop', servedModel: MODEL, usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } })

/** Two points per chunk, the summary states the first of each, so the run has three key point checks and a review. */
const script: ChatFn = async (request) => {
  const user = request.messages[request.messages.length - 1]?.content ?? ''
  const role = roleOf(request)
  if (role === 'extract') {
    const id = /^Chunk (\d+) of/.exec(user)?.[1]
    return reply(JSON.stringify({ points: [`Chunk ${id} states its rule.`, `Chunk ${id} adds a detail.`], entities: [] }))
  }
  if (role === 'check') return reply(JSON.stringify({ important: [] }))
  const ids = [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
  return reply(JSON.stringify({ overview: 'A lease.', sections: [{ heading: 'Terms', points: ids.map((id) => ({ text: `Rule ${id} holds.`, chunks: [id] })) }] }))
}

async function finishedView(): Promise<RunView> {
  const { frames } = await runSplit(THREE, withAttribution(script))
  return frames.reduce(applyFrame, { ...initialView(), phase: 'running' as const })
}

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

describe('the key point check rows read honestly on the page', () => {
  it('counts every call the readout describes: an extract and a key point check per chunk, plus the review', async () => {
    const view = await finishedView()
    const readout = text(renderToStaticMarkup(createElement(ReadoutStrip, { view })))

    // 3 extract + 3 key point checks + 1 review = 7 calls, and the sentence says what they are.
    expect(view.result?.metrics.cheapCalls).toBe(7)
    expect(readout).toContain('7 calls, an extract and a key point check per chunk, plus the review')
    expect(readout).not.toContain('one per chunk plus the review')
    expect(readout).toContain('Check 4')
  })

  it('shows the key point checks as one step of the path, then the review as check', async () => {
    const view = await finishedView()
    const labels = pathSteps(view).map((s) => s.label)

    expect(labels).toEqual(['split', 'extract, 3 chunks', 'reduce', 'synthesize', 'key point check, 3 chunks', 'check', 'final'])
  })

  it('names each key point check row by its chunk and gives every one a bar on the time axis', async () => {
    const view = await finishedView()
    const trace = renderToStaticMarkup(createElement(TracePanel, { view }))

    for (const n of [1, 2, 3]) expect(text(trace)).toContain(`Check chunk ${n} of 3`)
    expect(text(trace)).toContain('Key points checked against the summary')
    // Every finished row has a start mark, so every row has a bar, the check rows included.
    expect(trace.match(/ds-trace__bar/g)).toHaveLength(view.rows.length)
  })
})
