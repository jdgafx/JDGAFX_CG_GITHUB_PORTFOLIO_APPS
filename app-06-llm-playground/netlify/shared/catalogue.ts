import { MODEL, type CatalogueResponse, type ModelGroup, type ModelOption } from './contract'
import { CURATED_GROUPS } from './curated'
import { OPENROUTER_BASE } from './openrouter'
import { errorName, isRecord, perToken } from './parse'

const TTL_MS = 10 * 60 * 1000
const RETRY_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const OTHER_MIN_CONTEXT = 32_000
const OTHER_LABEL = 'All other live text models'
const CURATED_IDS = new Set(CURATED_GROUPS.flatMap(group => group.items.map(([id]) => id)))

export interface LiveModel {
  id: string
  name: string
  contextLength: number | null
  promptPerTok: number | null
  completionPerTok: number | null
  textOutput: boolean
}

interface Snapshot {
  fetchedAt: number
  models: Map<string, LiveModel>
}

// Module state is per function bundle. Each endpoint keeps its own copy of public data.
let snapshot: Snapshot | null = null
let lastAttempt = 0
let inflight: Promise<Snapshot | null> | null = null

async function fetchLive(): Promise<Map<string, LiveModel>> {
  // The catalogue is public, so no key is sent.
  const res = await fetch(`${OPENROUTER_BASE}/models`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`catalogue returned ${res.status}`)
  const payload: unknown = await res.json()
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new Error('catalogue has no data array')
  const models = new Map<string, LiveModel>()
  for (const raw of payload.data) {
    const model = parseModel(raw)
    if (model) models.set(model.id, model)
  }
  if (models.size === 0) throw new Error('catalogue is empty')
  return models
}

function parseModel(raw: unknown): LiveModel | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null
  const pricing: Record<string, unknown> = isRecord(raw.pricing) ? raw.pricing : {}
  const architecture: Record<string, unknown> = isRecord(raw.architecture) ? raw.architecture : {}
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id,
    contextLength: typeof raw.context_length === 'number' && raw.context_length > 0 ? raw.context_length : null,
    promptPerTok: perToken(pricing.prompt),
    completionPerTok: perToken(pricing.completion),
    textOutput: producesText(architecture),
  }
}

function producesText(architecture: Record<string, unknown>): boolean {
  const outputs = architecture.output_modalities
  if (Array.isArray(outputs)) return outputs.includes('text')
  // Older records only have "input->output", such as "text+image->text".
  const modality = typeof architecture.modality === 'string' ? architecture.modality : ''
  return (modality.split('->')[1] ?? '').split('+').includes('text')
}

async function refresh(): Promise<Snapshot | null> {
  lastAttempt = Date.now()
  try {
    snapshot = { fetchedAt: Date.now(), models: await fetchLive() }
  } catch (err) {
    const reason = err instanceof Error ? err.message : errorName(err)
    console.error(`Model catalogue refresh failed: ${reason}`)
  }
  return snapshot
}

// Serves a fresh copy when one exists. Otherwise it refreshes, at most once a minute
// during an outage, and falls back to the last good copy (or nothing).
async function current(): Promise<Snapshot | null> {
  if (snapshot && Date.now() - snapshot.fetchedAt < TTL_MS) return snapshot
  if (inflight) return inflight
  if (Date.now() - lastAttempt < RETRY_MS) return snapshot
  inflight = refresh().finally(() => {
    inflight = null
  })
  return inflight
}

export async function liveModels(): Promise<Map<string, LiveModel> | null> {
  return (await current())?.models ?? null
}

// An other-model the picker offers outside the curated groups. Compare accepts the same set.
function isOtherOffer(model: LiveModel): boolean {
  return (
    model.textOutput &&
    !CURATED_IDS.has(model.id) &&
    !model.id.startsWith('openrouter/') &&
    !model.id.includes(':free') &&
    !model.id.includes(':batch') &&
    (model.contextLength ?? 0) >= OTHER_MIN_CONTEXT
  )
}

// The IDs a compare may call, and exactly the IDs the picker offers. Live: the curated IDs the
// list still shows, plus the other-model offers. Fallback: the curated IDs, the only options in that mode.
export function acceptedIds(live: Map<string, LiveModel> | null): Set<string> {
  if (!live) return new Set(CURATED_IDS)
  const ids = new Set<string>()
  for (const id of CURATED_IDS) {
    if (live.get(id)?.textOutput) ids.add(id)
  }
  for (const model of live.values()) {
    if (isOtherOffer(model)) ids.add(model.id)
  }
  return ids
}

export async function catalogueView(): Promise<CatalogueResponse> {
  const snap = await current()
  if (!snap) {
    return { source: 'fallback', fetchedAt: null, defaultModel: MODEL, groups: curatedGroups(null) }
  }
  // Past its TTL the copy is served only while refreshes fail, so the page labels it cached.
  const source = Date.now() - snap.fetchedAt < TTL_MS ? 'live' : 'cached'
  return {
    source,
    fetchedAt: new Date(snap.fetchedAt).toISOString(),
    defaultModel: MODEL,
    groups: [...curatedGroups(snap.models), ...otherGroups(snap.models)],
  }
}

function curatedGroups(models: Map<string, LiveModel> | null): ModelGroup[] {
  return CURATED_GROUPS.map(group => ({
    label: group.label,
    options: group.items.flatMap(([id, why]) => {
      if (!models) return [option(id, undefined, why)]
      const live = models.get(id)
      return live && live.textOutput ? [option(id, live, why)] : []
    }),
  })).filter(group => group.options.length > 0)
}

function otherGroups(models: Map<string, LiveModel>): ModelGroup[] {
  const options: ModelOption[] = []
  for (const model of models.values()) {
    if (isOtherOffer(model)) options.push(option(model.id, model, ''))
  }
  if (options.length === 0) return []
  options.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [{ label: OTHER_LABEL, options }]
}

function option(id: string, live: LiveModel | undefined, why: string): ModelOption {
  return {
    id,
    label: live ? live.name : id,
    why,
    inPerM: perMillion(live?.promptPerTok ?? null),
    outPerM: perMillion(live?.completionPerTok ?? null),
    contextLength: live?.contextLength ?? null,
  }
}

// Prices arrive per token. Rounding removes floating-point noise, so 0.25 stays 0.25.
function perMillion(perToken: number | null): number | null {
  return perToken === null ? null : Number((perToken * 1_000_000).toPrecision(12))
}
