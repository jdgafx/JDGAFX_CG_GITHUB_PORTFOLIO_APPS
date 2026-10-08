import {
  BaseCheckpointSaver,
  copyCheckpoint,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { KeyValueStore } from './store'

/** One serialized value: the serializer's type tag and its bytes, base64 encoded for text storage. */
interface Packed {
  type: string
  data: string
}

interface CheckpointRecord {
  parent: string | null
  checkpoint: Packed
  metadata: Packed
}

interface WriteRecord {
  channel: string
  value: Packed
}

/** GraphGate has no subgraphs, so the only namespace ever stored is the root one. */
const ROOT_NAMESPACE = ''

// Keys. Ids are URI encoded, so no id can add a path segment.
const encodeId = (id: string) => encodeURIComponent(id)
const threadPrefix = (threadId: string) => `thread/${encodeId(threadId)}/`
const checkpointPrefix = (threadId: string) => `${threadPrefix(threadId)}checkpoint/`
const checkpointKey = (threadId: string, checkpointId: string) =>
  `${checkpointPrefix(threadId)}${encodeId(checkpointId)}`
const writesPrefix = (threadId: string, checkpointId: string) =>
  `${threadPrefix(threadId)}writes/${encodeId(checkpointId)}/`
const writeKey = (threadId: string, checkpointId: string, taskId: string, slot: number) =>
  `${writesPrefix(threadId, checkpointId)}${encodeId(taskId)}/${slot}`
const latestKey = (threadId: string) => `${threadPrefix(threadId)}latest`

function stringAt(config: RunnableConfig, key: string): string | undefined {
  const value: unknown = config.configurable?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function threadIdOf(config: RunnableConfig): string {
  const threadId = stringAt(config, 'thread_id')
  if (!threadId) throw new Error('Checkpoint calls need a thread_id in configurable.')
  return threadId
}

function assertRootNamespace(config: RunnableConfig): void {
  const namespace: unknown = config.configurable?.checkpoint_ns
  if (namespace !== undefined && namespace !== ROOT_NAMESPACE) {
    throw new Error('Only the root checkpoint namespace is stored. Subgraph namespaces are not supported.')
  }
}

function matchesFilter(metadata: CheckpointMetadata | undefined, filter: Record<string, unknown>): boolean {
  const fields = (metadata ?? {}) as Record<string, unknown>
  return Object.entries(filter).every(([key, value]) => fields[key] === value)
}

function rootConfig(threadId: string, checkpointId: string): RunnableConfig {
  return { configurable: { thread_id: threadId, checkpoint_ns: ROOT_NAMESPACE, checkpoint_id: checkpointId } }
}

/**
 * A LangGraph checkpointer that keeps every checkpoint and pending write in a key-value store.
 * Serialization uses the base class serializer, JsonPlusSerializer. Layout:
 *   thread/<id>/checkpoint/<checkpointId>            checkpoint and metadata record
 *   thread/<id>/writes/<checkpointId>/<task>/<slot>  one pending write
 *   thread/<id>/latest                               id of the newest checkpoint
 */
export class GraphGateSaver extends BaseCheckpointSaver {
  private readonly store: KeyValueStore

  constructor(store: KeyValueStore) {
    super()
    this.store = store
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    assertRootNamespace(config)
    const threadId = threadIdOf(config)
    const checkpointId = stringAt(config, 'checkpoint_id') ?? (await this.store.get(latestKey(threadId)))
    return checkpointId ? this.loadTuple(threadId, checkpointId) : undefined
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    assertRootNamespace(config)
    const threadId = threadIdOf(config)
    const prefix = checkpointPrefix(threadId)
    // Checkpoint ids are UUIDv6, so a plain descending sort is newest first.
    const ids = (await this.store.list(prefix))
      .map((key) => decodeURIComponent(key.slice(prefix.length)))
      .sort()
      .reverse()
    const beforeId = options?.before ? stringAt(options.before, 'checkpoint_id') : undefined
    let remaining = options?.limit ?? Number.POSITIVE_INFINITY
    for (const id of ids) {
      if (beforeId && id >= beforeId) continue
      const tuple = await this.loadTuple(threadId, id)
      if (!tuple) continue
      if (options?.filter && !matchesFilter(tuple.metadata, options.filter)) continue
      if (remaining <= 0) break
      remaining -= 1
      yield tuple
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    assertRootNamespace(config)
    const threadId = threadIdOf(config)
    const record: CheckpointRecord = {
      parent: stringAt(config, 'checkpoint_id') ?? null,
      checkpoint: await this.pack(copyCheckpoint(checkpoint)),
      metadata: await this.pack(metadata),
    }
    // The checkpoint is written before the latest pointer, so a pointer never names a missing checkpoint.
    await this.store.set(checkpointKey(threadId, checkpoint.id), JSON.stringify(record))
    await this.store.set(latestKey(threadId), checkpoint.id)
    return rootConfig(threadId, checkpoint.id)
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    assertRootNamespace(config)
    const threadId = threadIdOf(config)
    const checkpointId = stringAt(config, 'checkpoint_id')
    if (!checkpointId) throw new Error('Writes need a checkpoint_id in configurable.')
    await Promise.all(
      writes.map(async ([channel, value], index) => {
        // Special channels (interrupts, errors) take fixed negative slots. Ordinary writes keep their position.
        const slot = WRITES_IDX_MAP[channel] ?? index
        const key = writeKey(threadId, checkpointId, taskId, slot)
        // As in MemorySaver: an ordinary slot already written for this task keeps its first value.
        if (slot >= 0 && (await this.store.get(key)) !== undefined) return
        const record: WriteRecord = { channel, value: await this.pack(value) }
        await this.store.set(key, JSON.stringify(record))
      }),
    )
  }

  async deleteThread(threadId: string): Promise<void> {
    for (const key of await this.store.list(threadPrefix(threadId))) await this.store.delete(key)
  }

  private async pack(value: unknown): Promise<Packed> {
    const [type, bytes] = await this.serde.dumpsTyped(value)
    return { type, data: Buffer.from(bytes).toString('base64') }
  }

  private async unpack<T>(packed: Packed): Promise<T> {
    return (await this.serde.loadsTyped(packed.type, Buffer.from(packed.data, 'base64'))) as T
  }

  private async loadTuple(threadId: string, checkpointId: string): Promise<CheckpointTuple | undefined> {
    const raw = await this.store.get(checkpointKey(threadId, checkpointId))
    if (raw === undefined) return undefined
    const record = JSON.parse(raw) as CheckpointRecord
    const tuple: CheckpointTuple = {
      config: rootConfig(threadId, checkpointId),
      checkpoint: await this.unpack<Checkpoint>(record.checkpoint),
      metadata: await this.unpack<CheckpointMetadata>(record.metadata),
      pendingWrites: await this.loadWrites(threadId, checkpointId),
    }
    if (record.parent) tuple.parentConfig = rootConfig(threadId, record.parent)
    return tuple
  }

  private async loadWrites(threadId: string, checkpointId: string): Promise<CheckpointPendingWrite[]> {
    const prefix = writesPrefix(threadId, checkpointId)
    const rows: Array<{ taskId: string; slot: number; write: CheckpointPendingWrite }> = []
    for (const key of await this.store.list(prefix)) {
      const raw = await this.store.get(key)
      if (raw === undefined) continue
      const [encodedTask = '', slot = ''] = key.slice(prefix.length).split('/')
      const record = JSON.parse(raw) as WriteRecord
      const taskId = decodeURIComponent(encodedTask)
      rows.push({ taskId, slot: Number(slot), write: [taskId, record.channel, await this.unpack(record.value)] })
    }
    rows.sort((a, b) => (a.taskId === b.taskId ? a.slot - b.slot : a.taskId < b.taskId ? -1 : 1))
    return rows.map((row) => row.write)
  }
}
