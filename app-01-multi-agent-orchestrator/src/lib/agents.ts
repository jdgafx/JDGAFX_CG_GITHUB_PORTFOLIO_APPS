import type { AgentRole, AgentState, AgentStatus, ModelRole } from '../types'
import { isCutOff } from './finish'

/** The retriever comes first. The four model stages follow in MODEL_ORDER. */
export const AGENT_ORDER: AgentRole[] = ['retriever', 'researcher', 'analyst', 'critic', 'synthesizer']
export const MODEL_ORDER: ModelRole[] = ['researcher', 'analyst', 'critic', 'synthesizer']

/** Stage names match the server's trace. Descriptions show under each graph node. */
export const AGENT_META: Record<AgentRole, { name: string; description: string }> = {
  retriever: { name: 'Retrieve', description: 'Fetches live sources' },
  researcher: { name: 'Researcher', description: 'Lists cited facts' },
  analyst: { name: 'Analyst', description: 'Finds the patterns' },
  critic: { name: 'Critic', description: 'Points out the gaps' },
  synthesizer: { name: 'Synthesizer', description: 'Writes the final report' },
}

/** Section titles used in the exported report. */
export const AGENT_LABELS: Record<ModelRole, string> = {
  researcher: 'Research Findings',
  analyst: 'Analysis',
  critic: 'Critical Review',
  synthesizer: 'Final Synthesis',
}

/** An example the rail offers: a short name, the question, and where its sources come from. */
export interface Example {
  label: string
  question: string
  sources: string
}

/** Questions that Wikipedia and Hacker News can ground, so the Researcher has sources to cite and the audit has text to check. */
export const EXAMPLES: Example[] = [
  { label: 'Space telescope', question: 'What did the James Webb Space Telescope find in early galaxies?', sources: 'Wikipedia articles and Hacker News stories' },
  { label: 'Gene editing', question: 'How does CRISPR gene editing work and where is it used?', sources: 'Wikipedia articles and Hacker News stories' },
  { label: 'Systems languages', question: 'Why are developers adopting Rust for systems programming?', sources: 'Wikipedia articles and Hacker News stories' },
]

export const EXAMPLE_QUERIES = EXAMPLES.map(example => example.question)

/** A stage needs at least this much text before its output counts as usable. */
const MIN_USEFUL_CHARS = 40

/** The longest question the server accepts. The page and the function both import it. */
export const MAX_QUERY_CHARS = 500

export function createAgents(): Record<AgentRole, AgentState> {
  return Object.fromEntries(
    AGENT_ORDER.map(role => [
      role,
      {
        id: role,
        name: AGENT_META[role].name,
        description: AGENT_META[role].description,
        status: 'idle',
        output: '',
        maxTokens: 0,
        detail: 'Waiting to start.',
        finish: null,
        reasoningTokens: 0,
      } satisfies AgentState,
    ]),
  ) as Record<AgentRole, AgentState>
}

export function hasUsefulOutput(agent: AgentState): boolean {
  return agent.output.trim().length >= MIN_USEFUL_CHARS
}

/** True when the stage was cut off mid-answer rather than finishing cleanly. */
export function wasTruncated(agent: AgentState): boolean {
  return isCutOff(agent.finish)
}

/** Filename-safe slug. Punctuation-only queries fall back to a usable name. */
export function slugifyQuery(query: string): string {
  const slug = query
    .slice(0, 40)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || 'untitled'
}

export interface StatusView {
  word: string
  /** Class names for the dot beside the word. Colour never carries the state alone. */
  dot: string
}

const STATUS_VIEW: Record<AgentStatus, StatusView> = {
  idle: { word: 'Waiting', dot: 'ds-dot' },
  working: { word: 'Working', dot: 'ds-dot ds-dot--running' },
  complete: { word: 'Finished', dot: 'ds-dot ds-dot--ok' },
  error: { word: 'Failed', dot: 'ds-dot ds-dot--failed' },
  skipped: { word: 'Not run', dot: 'ds-dot ds-dot--skipped' },
  stopped: { word: 'Stopped', dot: 'ds-dot app-dot--warning' },
}

const CUT_OFF_VIEW: StatusView = { word: 'Cut off', dot: 'ds-dot app-dot--warning' }
const NO_SOURCES_VIEW: StatusView = { word: 'No sources', dot: 'ds-dot app-dot--warning' }

/** True when the retriever finished but found nothing, so the Researcher works without sources. */
export function foundNoSources(agent: AgentState): boolean {
  return agent.id === 'retriever' && agent.status === 'complete' && (agent.sources?.length ?? 0) === 0
}

/** The word and dot for a stage in the graph, the report tabs and the trace. One table for all three. */
export function statusView(agent: AgentState): StatusView {
  if (agent.status === 'complete') {
    if (wasTruncated(agent)) return CUT_OFF_VIEW
    if (foundNoSources(agent)) return NO_SOURCES_VIEW
  }
  return STATUS_VIEW[agent.status]
}
