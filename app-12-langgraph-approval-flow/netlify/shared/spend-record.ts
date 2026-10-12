import { NODES, type TraceRow } from '../../src/types'
import { guardStore, type KeyValueStore } from './store'

/**
 * What the failed attempts of a thread billed. A node that throws leaves no checkpoint row, so its spend would be
 * lost to the finished run and to a reopened thread. It is kept here, in the same store as the thread's checkpoints
 * (so a preview deploy writes to its own store, never to production), under `spend/<threadId>`.
 *
 * Each run opens the record (`open`) before it starts and closes it when it ends, with its failed attempt added.
 * An open record that no run owns means an attempt ended without saving what it billed: `lost`, and the totals read
 * "at least". Only the run that holds the thread's claim writes the record, so nothing is read, changed and written
 * back by two runs at once.
 */
export const SPEND_PREFIX = 'spend/'

export interface SpendRecord {
  /** The failed attempts, as rows: the step, its time, the billed reply or the calls that never reported. */
  failed: TraceRow[]
  /** A run has begun and not yet closed the record. */
  open: boolean
  /** An earlier attempt ended without saving its spend. */
  lost: boolean
}

const keyFor = (threadId: string) => `${SPEND_PREFIX}${threadId}`

/** A call of unknown cost: what stands for a failed attempt whose record could not be saved or read. */
const LOST_ROW: TraceRow = {
  node: NODES[0],
  status: 'failed',
  ms: 0,
  unreportedCalls: 1,
  detail: 'A run ended without saving what its model calls billed.',
}

const empty = (): SpendRecord => ({ failed: [], open: false, lost: false })

function parse(raw: string | undefined): SpendRecord {
  if (raw === undefined) return empty()
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null) {
      const { failed, open, lost } = value as Record<string, unknown>
      return { failed: Array.isArray(failed) ? (failed as TraceRow[]) : [], open: open === true, lost: lost === true }
    }
  } catch {
    // An unreadable record is a record whose contents are lost.
  }
  return { failed: [], open: false, lost: true }
}

/** The thread's record, or an empty one when it has none. A store failure throws. */
export async function readSpend(store: KeyValueStore, threadId: string): Promise<SpendRecord> {
  return parse(await store.get(keyFor(threadId)))
}

/**
 * The failed attempts as rows for the totals. A lost attempt is one row of one call not reported. An open record
 * counts as lost unless `running` says a run holds the thread right now.
 */
export function spentRows(record: SpendRecord, running = false): TraceRow[] {
  return record.lost || (record.open && !running) ? [...record.failed, LOST_ROW] : [...record.failed]
}

/** The spend rows for a read that could not reach the record: nothing is known, so one call is not reported. */
export function unreadableSpend(): TraceRow[] {
  return [LOST_ROW]
}

/** A run's hold on the thread's record: open at the start, closed at the end with the attempt that failed. */
export class SpendLedger {
  private constructor(
    private readonly store: KeyValueStore,
    private readonly threadId: string,
    private record: SpendRecord,
    /** False when the record could not be read, so nothing is written over it. */
    private trusted: boolean,
  ) {}

  /**
   * Opens the record. A new thread has none to read. Failing to read or to open never stops the run: the run goes on
   * and its totals say that something is missing.
   */
  static async begin(store: KeyValueStore, threadId: string, fresh: boolean, signal: AbortSignal | undefined): Promise<SpendLedger> {
    const bounded = guardStore(store, signal, 3_000)
    let record: SpendRecord
    try {
      record = fresh ? empty() : await readSpend(bounded, threadId)
    } catch (err) {
      console.error(`GraphGate: could not read the spend record of thread ${threadId}`, err)
      return new SpendLedger(store, threadId, { ...empty(), lost: true }, false)
    }
    // An earlier run that never closed its record spent something unknown. That stays known from here on.
    const ledger = new SpendLedger(store, threadId, { ...record, failed: [...record.failed], lost: record.lost || record.open }, true)
    try {
      await bounded.set(keyFor(threadId), JSON.stringify({ ...ledger.record, open: true }))
    } catch (err) {
      console.error(`GraphGate: could not open the spend record of thread ${threadId}`, err)
    }
    return ledger
  }

  /** The failed attempts so far, as rows for the totals, with a lost attempt shown as a call not reported. */
  rows(): TraceRow[] {
    return spentRows({ ...this.record, open: false })
  }

  /** Closes the record, adding this run's failed attempt when it has spend to show. Never throws. */
  async finish(failed: TraceRow | undefined, signal: AbortSignal | undefined): Promise<void> {
    if (failed && (failed.usage || failed.cost !== undefined || failed.unreportedCalls)) this.record.failed.push(failed)
    if (!this.trusted) return
    try {
      await guardStore(this.store, signal).set(keyFor(this.threadId), JSON.stringify({ ...this.record, open: false }))
    } catch (err) {
      console.error(`GraphGate: could not save the spend record of thread ${this.threadId}`, err)
    }
  }
}
