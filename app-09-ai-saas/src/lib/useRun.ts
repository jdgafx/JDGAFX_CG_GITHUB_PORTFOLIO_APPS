import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encodeRequest } from '../../shared/modelInput'
import type {
  Day,
  ExplainReply,
  ExplainRequest,
  PackageFacts,
  Release,
  Segment,
  ReleaseState,
  Rows,
  RunWindow,
  UnusualRow,
  WindowDays,
} from '../../shared/types'
import type { Judged, ShapeResult } from '../../shared/claims'
import type { Slot } from '../components/LiveChip'
import { markerFor, worstMarker, type ModelMarker, type ModelOutcome } from '../components/ModelChip'
import { MAX_NAMES, fetchRange, fetchReleases, isPackageName, todayUtc, type RangeResult, type ReleasesResult } from './npmClient'

/** Try it: four packages over a year, one of them with releases that match its spikes. Every figure is fetched live. */
export const TRY_IT = { names: ['react', 'vite', 'zod', '@anthropic-ai/sdk'], days: 365 as WindowDays }
/** A cold visit selects nothing: names come from Try it, a ready-made comparison or typing. */
export const DEFAULT_NAMES: string[] = []
export const DEFAULT_DAYS: WindowDays = 30
/** The browser gives up on one package's explanation here; the function's own model timeout is 26 s. */
export const EXPLAIN_ABORT_MS = 29_000
const MAX_UNUSUAL_SENT = 6

/** The functions WP1 provides (shared/*). Injected so the hook is testable and the swap is one line in App.tsx. */
export type { Judged }
export interface Core {
  computeWindow(rowsByName: Record<string, Rows>, runDate: Day, days: WindowDays): RunWindow
  computeFacts(
    rowsByName: Record<string, Rows>,
    window: RunWindow,
    releases: Record<string, Release[]>,
    releaseState: Record<string, ReleaseState>,
  ): PackageFacts[]
  judge(segments: Segment[], rowsByName: Record<string, Rows>, window: RunWindow, days: WindowDays): Judged[]
  /** The n strongest unusual rows, in day order. */
  topUnusual(rows: UnusualRow[], n?: number): UnusualRow[]
  /** The target's past-month rows, tagged no-data or possible-gap. */
  buildPastRows(rows: Rows, window: RunWindow, facts: PackageFacts): Array<[Day, number, 'no-data' | 'possible-gap' | null]>
  /** Which claim marks carry a figure, in reading order, as positions in the paragraphs given. */
  figureNumbers(paragraphs: Segment[][]): Array<{ paragraph: number; segment: number }>
  /** Shape limits. On failure the reason is a digit-free phrase, printed in the withheld notice. */
  validateShape(input: unknown): ShapeResult
}

export interface RunDeps {
  core: Core
  fetchRange?: (name: string, runDate: Day, signal?: AbortSignal) => Promise<RangeResult>
  fetchReleases?: (name: string, signal?: AbortSignal) => Promise<ReleasesResult>
  postExplain?: (req: ExplainRequest, signal: AbortSignal) => Promise<ExplainReply | null>
  now?: () => number
  today?: () => Day
}

type DlSlot = { status: 'loading' } | { status: 'ok'; rows: Rows } | { status: 'failed'; reason: string }
type RelSlot = { status: 'loading' } | { status: 'ok'; releases: Release[] } | { status: 'failed' }

/** Everything one view or one run is computed from. */
export interface Snapshot {
  runDate: Day
  names: string[]
  days: WindowDays
  /** Only the packages whose downloads arrived. */
  rowsByName: Record<string, Rows>
  failedNames: string[]
  releases: Record<string, Release[]>
  releaseState: Record<string, ReleaseState>
  window: RunWindow | null
  facts: PackageFacts[]
  /** A plain sentence when no window can be built. */
  error: string | null
}

export type PkgOutcome =
  | { status: 'pending' }
  | { status: 'ok'; judged: Judged[] }
  /** `message` is the function's own words for a refusal (a rate limit); absent for a timeout, a network failure or a 502. */
  | { status: 'error'; message?: string }
  | { status: 'withheld'; reason: string }

export interface RunState {
  phase: 'idle' | 'running' | 'done'
  /** The data the run was computed from, frozen when its fetches settled. */
  snapshot: Snapshot | null
  outcomes: Record<string, PkgOutcome>
  servedModel: string | null
  marker: ModelMarker
  modelOutcome: ModelOutcome | null
  elapsedMs: number | null
  reasoningTokens: number | null
  /** USD summed over the calls that reported a cost; null when none did ("cost unknown"). */
  cost: number | null
  /** Calls whose cost is not in `cost`: a timeout, an abort, a 502 or an answer without a cost. */
  costUnreported: number
}

const IDLE_RUN: RunState = {
  phase: 'idle',
  snapshot: null,
  outcomes: {},
  servedModel: null,
  marker: 'match',
  modelOutcome: null,
  elapsedMs: null,
  reasoningTokens: null,
  cost: null,
  costUnreported: 0,
}

const WITHHELD_WORDS: Record<string, string> = {
  'invalid:cut-off': 'the answer was cut off',
  'invalid:empty': 'the answer was empty',
  'invalid:not-json': 'the answer was not valid JSON',
  'invalid:bad-shape': 'the answer did not have the expected structure',
}

/** Builds a view of the fetched data. Pure: the same inputs give the same window, facts and error. */
export function derive(
  core: Core,
  names: string[],
  days: WindowDays,
  runDate: Day,
  downloads: Record<string, DlSlot>,
  releases: Record<string, RelSlot>,
): Snapshot {
  const rowsByName: Record<string, Rows> = {}
  const failedNames: string[] = []
  for (const name of names) {
    const slot = downloads[name]
    if (slot?.status === 'ok') rowsByName[name] = slot.rows
    else failedNames.push(name)
  }
  const okNames = names.filter(n => Object.hasOwn(rowsByName, n))
  const relMap: Record<string, Release[]> = {}
  const relState: Record<string, ReleaseState> = {}
  for (const name of okNames) {
    const slot = releases[name]
    relState[name] = slot?.status === 'ok' ? 'ok' : 'failed'
    relMap[name] = slot?.status === 'ok' ? slot.releases : []
  }
  const base = { runDate, names, days, rowsByName, failedNames, releases: relMap, releaseState: relState }
  if (okNames.length === 0) return { ...base, window: null, facts: [], error: 'npm did not answer for these packages.' }
  try {
    const window = core.computeWindow(rowsByName, runDate, days)
    const facts = core.computeFacts(rowsByName, window, relMap, relState)
    return { ...base, window, facts, error: null }
  } catch (error) {
    return { ...base, window: null, facts: [], error: error instanceof Error ? error.message : 'These figures could not be computed.' }
  }
}

/** The request for one package: it first, its peers after, six unusual rows each, its past-month rows tagged. */
export function buildRequest(core: Core, snap: Snapshot, target: string): ExplainRequest {
  const window = snap.window!
  const names = [target, ...snap.names.filter(n => n !== target && Object.hasOwn(snap.rowsByName, n))]
  const factsFor = (n: string) => snap.facts.find(f => f.name === n)!
  const facts = names.map(n => ({ ...factsFor(n), unusual: core.topUnusual(factsFor(n).unusual, MAX_UNUSUAL_SENT) }))
  const releaseState: Record<string, ReleaseState> = {}
  for (const n of names) releaseState[n] = snap.releaseState[n] ?? 'failed'
  const pastRows = { [target]: core.buildPastRows(snap.rowsByName[target] ?? {}, window, factsFor(target)) }
  return { target, names, window, facts, pastRows, releaseState }
}

/** The function turned the request away for rate limiting (429) and said so in its own words. No model call was made. */
export class ExplainRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExplainRefused'
  }
}

/** The real POST /api/explain. The body is encoded by shared code because the facts carry bigint totals. */
export async function postExplain(req: ExplainRequest, signal: AbortSignal): Promise<ExplainReply | null> {
  const res = await fetch('/api/explain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: encodeRequest(req),
    signal,
  })
  const body = (await res.json().catch(() => null)) as ExplainReply | { error?: unknown } | null
  if (body && typeof body === 'object' && 'ok' in body) return body
  // Only the rate limit is shown in the function's words: other refusals can carry digits, which the explanation region never prints.
  if (res.status === 429 && body && typeof body === 'object' && typeof body.error === 'string') throw new ExplainRefused(body.error)
  return null
}

interface Data {
  runDate: Day
  downloads: Record<string, DlSlot>
  releases: Record<string, RelSlot>
}

const loadingData = (names: string[], runDate: Day): Data => ({
  runDate,
  downloads: Object.fromEntries(names.map(n => [n, { status: 'loading' } as DlSlot])),
  releases: Object.fromEntries(names.map(n => [n, { status: 'loading' } as RelSlot])),
})

export function useRun(deps: RunDeps) {
  // The newest deps are read when a handler runs, so a changed function never restarts a fetch.
  const latest = useRef(deps)
  useEffect(() => {
    latest.current = deps
  })
  const { core } = deps

  const [names, setNames] = useState<string[]>(DEFAULT_NAMES)
  const [days, setDays] = useState<WindowDays>(DEFAULT_DAYS)
  const [data, setData] = useState<Data>(() => loadingData(DEFAULT_NAMES, (deps.today ?? todayUtc)()))
  const [run, setRun] = useState<RunState>(IDLE_RUN)

  const seq = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const live = useRef(false)
  const mounted = useRef(true)
  /** The controllers of the explain requests in flight, so leaving the page cancels them. */
  const posts = useRef(new Set<AbortController>())

  /** Fetches downloads and releases for the selection. Resolves with the settled slots, or null if a newer load replaced it. */
  const fetchAll = useCallback(async (nextNames: string[], date: Day) => {
    const d = latest.current
    const getRange = d.fetchRange ?? fetchRange
    const getReleases = d.fetchReleases ?? fetchReleases
    const mine = ++seq.current
    controller.current?.abort()
    const ctl = new AbortController()
    controller.current = ctl
    const dl: Record<string, DlSlot> = {}
    const rel: Record<string, RelSlot> = {}
    const current = () => mine === seq.current
    await Promise.all([
      ...nextNames.map(async name => {
        const r = await getRange(name, date, ctl.signal)
        const slot: DlSlot = r.status === 'ok' ? { status: 'ok', rows: r.rows } : { status: 'failed', reason: r.reason }
        dl[name] = slot
        if (current()) setData(prev => ({ ...prev, downloads: { ...prev.downloads, [name]: slot } }))
      }),
      ...nextNames.map(async name => {
        const r = await getReleases(name, ctl.signal)
        const slot: RelSlot = r.status === 'ok' ? { status: 'ok', releases: r.releases } : { status: 'failed' }
        rel[name] = slot
        if (current()) setData(prev => ({ ...prev, releases: { ...prev.releases, [name]: slot } }))
      }),
    ])
    return current() ? { date, dl, rel } : null
  }, [])

  /** Puts every slot of the selection back to loading, dated today (UTC). */
  const begin = useCallback((nextNames: string[]): Day => {
    const date = (latest.current.today ?? todayUtc)()
    setData(loadingData(nextNames, date))
    return date
  }, [])

  /** A new selection: the data is fetched fresh, and any earlier result is cleared. */
  const select = useCallback(
    (nextNames: string[], nextDays: WindowDays) => {
      if (live.current) return
      setNames(nextNames)
      setDays(nextDays)
      setRun(IDLE_RUN)
      void fetchAll(nextNames, begin(nextNames))
    },
    [fetchAll, begin],
  )

  useEffect(() => {
    mounted.current = true
    const inFlight = posts.current
    return () => {
      mounted.current = false
      // A fetch that settles after this is no longer current, so it writes nothing.
      seq.current += 1
      controller.current?.abort()
      for (const ctl of inFlight) ctl.abort()
    }
  }, [])
  /** setRun that does nothing once the page is gone. */
  const publishRun = useCallback((next: RunState) => {
    if (mounted.current) setRun(next)
  }, [])

  const { runDate, downloads, releases } = data
  const dlSlots = names.map(n => downloads[n]?.status ?? 'loading') as Slot[]
  const relSlots = names.map(n => releases[n]?.status ?? 'loading') as Slot[]
  const settled = dlSlots.every(s => s !== 'loading') && relSlots.every(s => s !== 'loading')

  const view = useMemo(
    () => (settled && names.length > 0 ? derive(core, names, days, runDate, downloads, releases) : null),
    [settled, core, names, days, runDate, downloads, releases],
  )
  /** Both fetches have settled (ok or failed) and no run is live: Try it may start. */
  const canStart = settled && run.phase !== 'running'
  /** The same, and there is a window to explain. */
  const canRun = canStart && view !== null && view.error === null

  const explain = useCallback(
    async (nextNames: string[] = names, nextDays: WindowDays = days) => {
      if (live.current) return
      live.current = true
      const d = latest.current
      const now = d.now ?? (() => performance.now())
      const post = d.postExplain ?? postExplain
      const startedAt = now()
      setRun({ ...IDLE_RUN, phase: 'running' })
      try {
        // Explain spikes and Try it always refetch: nothing is cached by the app.
        const loaded = await fetchAll(nextNames, begin(nextNames))
        if (!loaded) {
          publishRun(IDLE_RUN)
          return
        }
        const snap = derive(d.core, nextNames, nextDays, loaded.date, loaded.dl, loaded.rel)
        if (snap.error !== null || snap.window === null) {
          publishRun({ ...IDLE_RUN, phase: 'done', snapshot: snap, modelOutcome: null, elapsedMs: now() - startedAt })
          return
        }
        const targets = snap.names.filter(n => Object.hasOwn(snap.rowsByName, n))
        const outcomes: Record<string, PkgOutcome> = Object.fromEntries(targets.map(n => [n, { status: 'pending' } as PkgOutcome]))
        const markers: ModelMarker[] = []
        const served: Array<string | null> = []
        let answered = 0
        let failed = 0
        let reasoning = 0
        let usageSeen = false
        let cost = 0
        let costReported = 0
        let costUnreported = 0
        const publish = (final: boolean) =>
          publishRun({
            phase: final ? 'done' : 'running',
            snapshot: snap,
            outcomes: { ...outcomes },
            servedModel: served.find(s => s !== null) ?? null,
            marker: worstMarker(markers),
            modelOutcome: failed === 0 ? 'ok' : answered === 0 ? 'all-failed' : 'partial',
            elapsedMs: final ? now() - startedAt : null,
            reasoningTokens: final && usageSeen ? reasoning : null,
            cost: final && costReported > 0 ? cost : null,
            costUnreported: final ? costUnreported : 0,
          })
        publish(false)
        await Promise.all(
          targets.map(async target => {
            const ctl = new AbortController()
            posts.current.add(ctl)
            const timer = setTimeout(() => ctl.abort(), EXPLAIN_ABORT_MS)
            try {
              const body = await post(buildRequest(d.core, snap, target), ctl.signal)
              if (!mounted.current) return
              // Every call is counted: what it cost if the function knew, else one more call not reported.
              if (body?.costUsd != null) {
                cost += body.costUsd
                costReported += 1
              } else costUnreported += 1
              if (body?.usage) {
                reasoning += body.usage.reasoning
                usageSeen = true
              }
              if (!body || (!body.ok && body.reason === 'model-unavailable')) {
                outcomes[target] = { status: 'error' }
                failed += 1
              } else {
                answered += 1
                const marker = markerFor(body.servedModel, body.newestModel)
                if (marker === 'mismatch') console.warn(`app-09: the served model ${body.servedModel} is not the newest (${body.newestModel})`)
                markers.push(marker)
                served.push(body.servedModel)
                if (!body.ok) {
                  outcomes[target] = { status: 'withheld', reason: WITHHELD_WORDS[body.reason] ?? 'the answer was not in the agreed format' }
                } else {
                  const shape = d.core.validateShape(body.paragraph)
                  outcomes[target] = shape.ok
                    ? { status: 'ok', judged: d.core.judge(body.paragraph, snap.rowsByName, snap.window!, nextDays) }
                    : { status: 'withheld', reason: shape.reason }
                }
              }
            } catch (error) {
              if (!mounted.current) return
              outcomes[target] = error instanceof ExplainRefused ? { status: 'error', message: error.message } : { status: 'error' }
              failed += 1
              // A rate-limited call never reached the model: its cost is known, and it is nothing.
              if (error instanceof ExplainRefused) costReported += 1
              else costUnreported += 1
            } finally {
              clearTimeout(timer)
              posts.current.delete(ctl)
            }
            const last = Object.values(outcomes).every(o => o.status !== 'pending')
            publish(last)
          }),
        )
      } finally {
        live.current = false
      }
    },
    [names, days, fetchAll, begin, publishRun],
  )

  const addName = useCallback(
    (raw: string): string | null => {
      const name = raw.trim().toLowerCase()
      if (!isPackageName(name)) return 'That is not a valid npm package name.'
      if (names.includes(name)) return 'That package is already selected.'
      if (names.length >= MAX_NAMES) return `Up to ${MAX_NAMES} packages.`
      select([...names, name], days)
      return null
    },
    [names, days, select],
  )

  return {
    names,
    days,
    view,
    run,
    canRun,
    canStart,
    settled,
    liveSlots: { downloads: dlSlots, releases: relSlots },
    addName,
    removeName: (name: string) => select(names.filter(n => n !== name), days),
    setPreset: (next: string[]) => select(next, days),
    setDays: (next: WindowDays) => select(names, next),
    explain: () => explain(),
    tryIt: () => {
      if (live.current || !settled) return
      setNames([...TRY_IT.names])
      setDays(TRY_IT.days)
      void explain([...TRY_IT.names], TRY_IT.days)
    },
  }
}
