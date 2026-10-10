import { TRY_TASK } from './constants'

/**
 * What Try it does: it puts the example in the task field and starts the same run as Plan and run. The run reads
 * the live page, so the result is never stored.
 */
export function runExample(setTask: (task: string) => void, plan: (task: string) => Promise<void>): Promise<void> {
  setTask(TRY_TASK)
  return plan(TRY_TASK)
}
