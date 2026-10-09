import { useCallback, useEffect, useRef, useState } from 'react'
import { SLOTS, type CatalogueResponse, type CompareRequest, type LeaderboardResponse, type VoteChoice } from '../../netlify/shared/contract'
import { ApiError, fetchLeaderboard, isAbortError, runCompare, runJudge, runVote } from './api'
import { failedJudgeStep, startedRun, type Mode, type RunView } from './run'

export type BoardState =
  | { state: 'loading' }
  | { state: 'ready'; board: LeaderboardResponse }
  | { state: 'error'; message: string }

export interface RunInput {
  mode: Mode
  prompt: string
  system: string
  temperature: number | null
  models: [string, string]
}

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
}

/**
 * The run, its vote and the shared leaderboard. A blind run is two steps: compare returns the answers
 * with the models withheld, and the judge starts at once but stays hidden; the vote reveals the models
 * and the judge together. `generation` makes a late reply from a cleared or replaced run harmless.
 */
export function useArena(catalogue: CatalogueResponse | null) {
  const [run, setRun] = useState<RunView | null>(null)
  const [board, setBoard] = useState<BoardState>({ state: 'loading' })
  const controllerRef = useRef<AbortController | null>(null)
  const generation = useRef(0)

  const update = useCallback((gen: number, change: (prev: RunView) => RunView) => {
    if (gen === generation.current) setRun(prev => (prev ? change(prev) : prev))
  }, [])

  const refreshBoard = useCallback(async (signal?: AbortSignal) => {
    setBoard(prev => (prev.state === 'ready' ? prev : { state: 'loading' }))
    try {
      setBoard({ state: 'ready', board: await fetchLeaderboard(signal) })
    } catch (err) {
      if (!isAbortError(err)) setBoard({ state: 'error', message: messageFor(err) })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refreshBoard(controller.signal)
    return () => controller.abort()
  }, [refreshBoard])

  async function start(input: RunInput) {
    if (!catalogue) return
    controllerRef.current?.abort()
    const gen = ++generation.current
    const controller = new AbortController()
    controllerRef.current = controller
    setRun(startedRun(input.mode, input.prompt))
    const request: CompareRequest = {
      prompt: input.prompt,
      models: [catalogue.defaultModel, input.models[0], input.models[1]],
      system: input.system.trim() === '' ? undefined : input.system,
      temperature: input.temperature ?? undefined,
      blind: input.mode === 'blind' ? true : undefined,
    }
    try {
      const result = await runCompare(request, controller.signal)
      if (result.blind === true) {
        update(gen, prev => ({ ...prev, status: 'voting', blind: result, judge: { state: 'running' } }))
        // The judge reads the answers under the labels the visitor sees. Its verdict is held until the vote.
        const answers = result.answers.filter(a => a.ok).map(a => ({ slot: a.label, text: a.text }))
        runJudge({ prompt: input.prompt, answers }, controller.signal)
          .then(verdict =>
            update(gen, prev => ({
              ...prev,
              judge: verdict.ok ? { state: 'done', verdict } : { state: 'failed', step: verdict.trace[0], model: verdict.model },
            })),
          )
          .catch((err: unknown) =>
            update(gen, prev => ({
              ...prev,
              judge: { state: 'failed', step: failedJudgeStep(isAbortError(err) ? 'Stopped before the judge answered.' : messageFor(err)), model: null },
            })),
          )
        return
      }
      const answers = result.panels.flatMap(p => (p.ok ? [{ slot: p.slot, text: p.text }] : []))
      const notice = input.mode === 'blind' ? (result.notVoteable ?? null) : null
      if (answers.length < 2) {
        update(gen, prev => ({
          ...prev,
          status: 'done',
          compare: result,
          notice,
          judge: { state: 'skipped', reason: `The judge needs two answers. ${answers.length} of ${SLOTS.length} panels answered.` },
        }))
        return
      }
      update(gen, prev => ({ ...prev, compare: result, notice, judge: { state: 'running' } }))
      const verdict = await runJudge({ prompt: input.prompt, answers }, controller.signal)
      update(gen, prev => ({
        ...prev,
        status: 'done',
        judge: verdict.ok ? { state: 'done', verdict } : { state: 'failed', step: verdict.trace[0], model: verdict.model },
      }))
    } catch (err) {
      const stopped = isAbortError(err)
      update(gen, prev => {
        // Before the panels answered, the whole run failed or stopped.
        if (!prev.compare) return { ...prev, status: stopped ? 'stopped' : 'error', error: stopped ? null : messageFor(err) }
        // The panels answered, so keep them and mark only the judge step.
        return {
          ...prev,
          status: stopped ? 'stopped' : 'done',
          judge: { state: 'failed', step: failedJudgeStep(stopped ? 'Stopped before the judge answered.' : messageFor(err)), model: null },
        }
      })
    }
  }

  async function vote(choice: VoteChoice) {
    const blind = run?.blind
    if (!blind) return
    const gen = generation.current
    update(gen, prev => ({ ...prev, vote: { state: 'sending', choice } }))
    try {
      const reply = await runVote({ runId: blind.runId, choice })
      update(gen, prev => ({
        ...prev,
        status: 'done',
        blind: null,
        compare: reply.compare,
        vote: { state: 'counted', choice, changes: reply.changes },
      }))
      setBoard({ state: 'ready', board: reply.leaderboard })
    } catch (err) {
      // 409 and 410 mean this run can never take a vote; anything else can be tried again.
      const final = err instanceof ApiError && (err.status === 409 || err.status === 410)
      update(gen, prev => ({ ...prev, vote: { state: 'failed', message: messageFor(err), final } }))
    }
  }

  function stop() {
    controllerRef.current?.abort()
  }

  function clear() {
    generation.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setRun(null)
  }

  return { run, board, start, vote, stop, clear, refreshBoard }
}
