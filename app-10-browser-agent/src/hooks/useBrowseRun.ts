import { useCallback, useEffect, useReducer, useRef } from 'react'
import { planTask, RequestFailure, streamRun } from '../lib/api'
import { RETRY_DELAY_MS, shouldRetryRun } from '../lib/retry'
import { initialRunState, runReducer } from '../lib/runState'
import type { BotStep } from '../types'

/**
 * Plan-and-run state for the page. Every server event passes through the reducer, and events
 * from a run that was stopped or replaced are dropped.
 */
export function useBrowseRun() {
  const [state, dispatch] = useReducer(runReducer, initialRunState)
  const controllerRef = useRef<AbortController | null>(null)

  const startController = useCallback((): AbortController => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  }, [])

  const execute = useCallback(async (steps: BotStep[], controller: AbortController, replay: boolean) => {
    dispatch({ type: 'running', replay, at: Date.now() })
    // The run is started a second time, once, when the server fails or the connection is cut before any step finished.
    for (let attempt = 0; attempt < 2; attempt++) {
      let progressed = false
      let concluded = false
      try {
        await streamRun(steps, (event) => {
          if (controller.signal.aborted) return
          if (event.type === 'step_complete') progressed = true
          if (event.type === 'done' || event.type === 'error') concluded = true
          dispatch({ type: 'event', event, at: Date.now() })
        }, controller.signal)
        if (controller.signal.aborted) return
        if (shouldRetryRun(attempt, progressed, concluded)) {
          dispatch({ type: 'retrying' })
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          if (controller.signal.aborted) return
          continue
        }
        dispatch({ type: 'streamEnded' })
        return
      } catch (error) {
        if (controller.signal.aborted) return
        if (shouldRetryRun(attempt, progressed, false, error)) {
          dispatch({ type: 'retrying' })
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          if (controller.signal.aborted) return
          continue
        }
        dispatch({
          type: 'runFailed',
          message: error instanceof RequestFailure
            ? error.message
            : 'Something went wrong while running the plan. Try again.',
        })
        return
      }
    }
  }, [])

  const planAndRun = useCallback(async (task: string) => {
    const controller = startController()
    dispatch({ type: 'planning', at: Date.now() })
    try {
      const plan = await planTask(task, controller.signal)
      if (controller.signal.aborted) return
      dispatch({ type: 'planned', plan })
      await execute(plan.result.steps, controller, false)
    } catch (error) {
      if (controller.signal.aborted) return
      const failure = error instanceof RequestFailure ? error : null
      dispatch({
        type: 'planFailed',
        message: failure?.message ?? 'Something went wrong while planning this task. Try again.',
        trace: failure?.trace ?? [],
      })
    }
  }, [execute, startController])

  const runAgain = useCallback(() => {
    if (state.steps.length === 0) return
    void execute(state.steps, startController(), true)
  }, [execute, startController, state.steps])

  const stop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    dispatch({ type: 'stopped' })
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    dispatch({ type: 'reset' })
  }, [])

  useEffect(() => () => controllerRef.current?.abort(), [])

  return { state, planAndRun, runAgain, stop, reset }
}
