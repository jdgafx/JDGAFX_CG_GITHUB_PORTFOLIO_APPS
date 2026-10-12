import { useEffect } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplainReply, ExplainRequest } from '../../shared/types'
import { useRun, type RunDeps } from '../../src/lib/useRun'
import { cleanup, explainFromCapture, flush, mount } from '../ui/helpers'
import { makeStubCore, stubFacts } from '../ui/stubCore'
import r1aReact from '../ui/fixtures/response-r1a-react.json'
import r1aVite from '../ui/fixtures/response-r1a-vite.json'
import r1aZod from '../ui/fixtures/response-r1a-zod.json'
import r1aSdk from '../ui/fixtures/response-r1a-anthropic-ai2Fsdk.json'

type Api = ReturnType<typeof useRun>

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

async function setup(deps: Partial<RunDeps> = {}) {
  const holder: { api: Api | null } = { api: null }
  function Probe({ d }: { d: RunDeps }) {
    const api = useRun(d)
    useEffect(() => {
      holder.api = api
    })
    return null
  }
  const full: RunDeps = {
    core: makeStubCore(),
    fetchRange: async name => ({ name, status: 'ok', rows: {} }),
    fetchReleases: async name => ({ name, status: 'ok', releases: [] }),
    ...deps,
  }
  mount(<Probe d={full} />)
  // a cold visit selects nothing: start from one package
  await act(async () => holder.api!.setPreset(['react']))
  return { get api() { return holder.api! } }
}

const reply = (capture: unknown, extra: Partial<{ newestModel: string | null; costUsd: number | null }> = {}): ExplainReply => ({
  ...explainFromCapture(capture),
  newestModel: 'anthropic/claude-haiku-5.5',
  costUsd: 0.0016,
  ...extra,
})
const unavailable: ExplainReply = { ok: false, reason: 'model-unavailable', servedModel: null, newestModel: null, costUsd: null }

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRun gating', () => {
  it('Explain spikes stays off until downloads and releases have both settled', async () => {
    const dl = deferred<{ name: string; status: 'ok'; rows: Record<string, number> }>()
    const rel = deferred<{ name: string; status: 'failed'; releases: never[] }>()
    const s = await setup({ fetchRange: () => dl.promise, fetchReleases: () => rel.promise })
    await flush()
    expect(s.api.canRun).toBe(false)
    await act(async () => dl.resolve({ name: 'react', status: 'ok', rows: {} }))
    expect(s.api.settled).toBe(false)
    expect(s.api.canRun).toBe(false)
    await act(async () => rel.resolve({ name: 'react', status: 'failed', releases: [] }))
    // a failed release history still settles: the run may go ahead
    expect(s.api.settled).toBe(true)
    expect(s.api.canRun).toBe(true)
  })

  it('is off when no package has downloads, and while a run is live', async () => {
    const down = await setup({ fetchRange: async name => ({ name, status: 'failed', reason: 'network' }) })
    await flush()
    expect(down.api.settled).toBe(true)
    expect(down.api.canRun).toBe(false)

    const gate = deferred<ExplainReply>()
    const s = await setup({ postExplain: () => gate.promise })
    await flush()
    expect(s.api.canRun).toBe(true)
    await act(async () => void s.api.explain())
    await flush()
    expect(s.api.run.phase).toBe('running')
    expect(s.api.canRun).toBe(false)
    await act(async () => gate.resolve(reply(r1aReact)))
    await flush()
    expect(s.api.run.phase).toBe('done')
    expect(s.api.canRun).toBe(true)
  })

  it('a name or window change refetches both, and Explain spikes refetches again', async () => {
    const fetchRange = vi.fn<NonNullable<RunDeps['fetchRange']>>(async name => ({ name, status: 'ok', rows: {} }))
    const fetchReleases = vi.fn<NonNullable<RunDeps['fetchReleases']>>(async name => ({ name, status: 'ok', releases: [] }))
    const s = await setup({ fetchRange, fetchReleases, postExplain: async () => reply(r1aReact) })
    await flush()
    const base = fetchRange.mock.calls.length
    await act(async () => s.api.setDays(90))
    await flush()
    expect(fetchRange.mock.calls.length).toBe(base + 1)
    await act(async () => void s.api.explain())
    await flush(6)
    expect(fetchRange.mock.calls.length).toBe(base + 2)
    expect(fetchReleases.mock.calls.length).toBe(base + 2)
  })

  it('addName normalises, refuses a bad name, a repeat and a fifth package', async () => {
    const s = await setup()
    await flush()
    expect(s.api.addName('  VUE ')).toBeNull()
    await flush()
    expect(s.api.names).toEqual(['react', 'vue'])
    expect(s.api.addName('vue')).toMatch(/already/)
    expect(s.api.addName('not a name')).toMatch(/valid npm package name/)
    await act(async () => void s.api.addName('zod'))
    await act(async () => void s.api.addName('vite'))
    await flush()
    expect(s.api.names).toHaveLength(4)
    expect(s.api.addName('svelte')).toBe('Up to 4 packages.')
  })
})

describe('useRun explain', () => {
  it('Try it sets the four r1 names in order and 365, waits for both fetches, then posts 4 requests in parallel', async () => {
    const relGate = deferred<void>()
    const posts: ExplainRequest[] = []
    const gate = deferred<ExplainReply>()
    const s = await setup({
      fetchReleases: async name => {
        if (name === 'zod') await relGate.promise
        return { name, status: 'ok', releases: [] }
      },
      postExplain: async req => {
        posts.push(req)
        return gate.promise
      },
    })
    await flush()
    await act(async () => s.api.tryIt())
    await flush()
    expect(s.api.names).toEqual(['react', 'vite', 'zod', '@anthropic-ai/sdk'])
    expect(s.api.days).toBe(365)
    expect(posts).toHaveLength(0)
    await act(async () => relGate.resolve())
    await flush(6)
    // all four are in flight before any one answers
    expect(posts.map(p => p.target)).toEqual(['react', 'vite', 'zod', '@anthropic-ai/sdk'])
    for (const p of posts) {
      expect(p.names[0]).toBe(p.target)
      expect(p.names).toHaveLength(4)
      expect(p.facts.every(f => f.unusual.length <= 6)).toBe(true)
      expect(Object.keys(p.pastRows)).toEqual([p.target])
      expect(p.pastRows[p.target]).toHaveLength(30)
    }
    await act(async () => gate.resolve(reply(r1aReact)))
    await flush()
  })

  it('a double submit makes one set of requests', async () => {
    const post = vi.fn(async () => reply(r1aReact))
    const fetchRange = vi.fn<NonNullable<RunDeps['fetchRange']>>(async name => ({ name, status: 'ok', rows: {} }))
    const s = await setup({ postExplain: post, fetchRange })
    await flush()
    const base = fetchRange.mock.calls.length
    await act(async () => {
      void s.api.explain()
      void s.api.explain()
    })
    await flush(6)
    expect(post).toHaveBeenCalledTimes(1)
    expect(fetchRange.mock.calls.length).toBe(base + 1)
  })

  it('one failed call leaves the others shown and the chip partial', async () => {
    const answers = [reply(r1aReact), unavailable, reply(r1aZod), reply(r1aSdk)]
    const s = await setup({ postExplain: async req => answers[['react', 'vite', 'zod', '@anthropic-ai/sdk'].indexOf(req.target)]! })
    await flush()
    await act(async () => s.api.tryIt())
    await flush(8)
    expect(s.api.run.phase).toBe('done')
    expect(s.api.run.outcomes.vite).toEqual({ status: 'error' })
    expect(s.api.run.outcomes.react?.status).toBe('ok')
    expect(s.api.run.outcomes.zod?.status).toBe('ok')
    expect(s.api.run.modelOutcome).toBe('partial')
  })

  it('every call failing gives all-failed and no cost', async () => {
    const s = await setup({ postExplain: async () => unavailable })
    await flush()
    await act(async () => void s.api.explain())
    await flush(6)
    expect(s.api.run.modelOutcome).toBe('all-failed')
    expect(s.api.run.cost).toBeNull()
    expect(s.api.run.phase).toBe('done')
  })

  it('shows the worst marker across calls and warns on a model that is not the newest', async () => {
    const answers = {
      react: reply(r1aReact),
      vite: reply(r1aVite, { newestModel: 'anthropic/claude-haiku-6' }),
    } as Record<string, ExplainReply>
    const s = await setup({ postExplain: async req => answers[req.target]! })
    await flush()
    await act(async () => s.api.setPreset(['react', 'vite']))
    await flush()
    await act(async () => void s.api.explain())
    await flush(8)
    expect(s.api.run.marker).toBe('mismatch')
    expect(console.warn).toHaveBeenCalled()
  })

  it('marks "unchecked" when the newest model is unknown and "not-reported" when the call names none', async () => {
    const a = await setup({ postExplain: async () => reply(r1aReact, { newestModel: null }) })
    await flush()
    await act(async () => void a.api.explain())
    await flush(6)
    expect(a.api.run.marker).toBe('unchecked')
    const b = await setup({ postExplain: async () => ({ ...reply(r1aReact), servedModel: null }) })
    await flush()
    await act(async () => void b.api.explain())
    await flush(6)
    expect(b.api.run.marker).toBe('not-reported')
  })

  it('elapsed runs from the click to the last paragraph', async () => {
    let t = 1000
    const gates = [deferred<ExplainReply>(), deferred<ExplainReply>()]
    const s = await setup({ now: () => t, postExplain: req => gates[req.target === 'react' ? 0 : 1]!.promise })
    await flush()
    await act(async () => s.api.setPreset(['react', 'vite']))
    await flush()
    t = 2000
    await act(async () => void s.api.explain())
    await flush(6)
    t = 9000
    await act(async () => gates[0]!.resolve(reply(r1aReact)))
    expect(s.api.run.phase).toBe('running')
    expect(s.api.run.elapsedMs).toBeNull()
    t = 17_500
    await act(async () => gates[1]!.resolve(reply(r1aVite)))
    await flush()
    expect(s.api.run.phase).toBe('done')
    expect(s.api.run.elapsedMs).toBe(15_500)
  })

  it('aborts one package after 29 seconds and the others still render', async () => {
    vi.useFakeTimers()
    const s = await setup({
      postExplain: (req, signal) =>
        req.target === 'react'
          ? Promise.resolve(reply(r1aReact))
          : new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => s.api.setPreset(['react', 'vite']))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => void s.api.explain())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(28_999)
    })
    expect(s.api.run.phase).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(s.api.run.phase).toBe('done')
    expect(s.api.run.outcomes.vite).toEqual({ status: 'error' })
    expect(s.api.run.outcomes.react?.status).toBe('ok')
  })

  it('withholds a paragraph the function reports invalid, and one over the shape limits, in words', async () => {
    const s = await setup({
      core: makeStubCore({ validateShape: input => ((input as unknown[]).length > 0 ? { ok: false, reason: 'the paragraph was too long' } : { ok: true }) }),
      postExplain: async req => (req.target === 'react' ? { ok: false, reason: 'invalid:cut-off', servedModel: 'm', newestModel: null, costUsd: 0.001 } : reply(r1aVite)),
    })
    await flush()
    await act(async () => s.api.setPreset(['react', 'vite']))
    await flush()
    await act(async () => void s.api.explain())
    await flush(8)
    expect(s.api.run.outcomes.react).toEqual({ status: 'withheld', reason: 'the answer was cut off' })
    expect(s.api.run.outcomes.vite).toEqual({ status: 'withheld', reason: 'the paragraph was too long' })
  })

  it('a failed release history is sent as releaseState failed and does not stop the run', async () => {
    const posts: ExplainRequest[] = []
    const s = await setup({
      fetchReleases: async name => ({ name, status: 'failed', releases: [] }),
      postExplain: async req => {
        posts.push(req)
        return reply(r1aReact)
      },
    })
    await flush()
    expect(s.api.canRun).toBe(true)
    await act(async () => void s.api.explain())
    await flush(6)
    expect(posts[0]?.releaseState).toEqual({ react: 'failed' })
  })

  it('sums reasoning tokens and the function-priced cost, or says cost unknown', async () => {
    const a = await setup({ postExplain: async () => reply(r1aReact, { costUsd: 0.00160875 }) })
    await flush()
    await act(async () => void a.api.explain())
    await flush(6)
    const sent = explainFromCapture(r1aReact)
    const expected = sent.ok ? sent.usage?.reasoning : undefined
    expect(expected).toBeGreaterThan(0)
    expect(a.api.run.reasoningTokens).toBe(expected)
    expect(a.api.run.cost).toBeCloseTo(0.00160875, 10)
    const b = await setup({ postExplain: async () => reply(r1aReact, { costUsd: null }) })
    await flush()
    await act(async () => void b.api.explain())
    await flush(6)
    expect(b.api.run.cost).toBeNull()
  })

  it('cuts the unusual rows to the six strongest, in day order', async () => {
    const posts: ExplainRequest[] = []
    const s = await setup({
      core: makeStubCore({ computeFacts: rows => Object.keys(rows).map(n => stubFacts(n, 9)) }),
      postExplain: async req => {
        posts.push(req)
        return reply(r1aReact)
      },
    })
    await flush()
    await act(async () => void s.api.explain())
    await flush(6)
    const days = posts[0]!.facts[0]!.unusual.map(u => u.day)
    expect(days).toHaveLength(6)
    expect(days).toEqual([...days].sort())
    expect(days[5]).toBe('2026-09-18')
  })
})
