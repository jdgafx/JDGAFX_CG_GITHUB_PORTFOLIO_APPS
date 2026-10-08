import type { AgentRole, AgentState } from '../types'

export const AGENT_ORDER: AgentRole[] = ['researcher', 'analyst', 'critic', 'synthesizer']

/** Stage names match the server's trace. Descriptions show under each graph node. */
export const AGENT_META: Record<AgentRole, { name: string; description: string }> = {
  researcher: { name: 'Researcher', description: 'Gathers the key facts' },
  analyst: { name: 'Analyst', description: 'Finds the patterns' },
  critic: { name: 'Critic', description: 'Points out the gaps' },
  synthesizer: { name: 'Synthesizer', description: 'Writes the final report' },
}

/** Section titles used in the exported report. */
export const AGENT_LABELS: Record<AgentRole, string> = {
  researcher: 'Research Findings',
  analyst: 'Analysis',
  critic: 'Critical Review',
  synthesizer: 'Final Synthesis',
}

export const EXAMPLE_QUERIES = [
  'How is AI changing software engineering jobs?',
  'Is nuclear power a realistic path to net zero?',
  'What drives the rise of the creator economy?',
]

/** A stage needs at least this much text before its output counts as usable. */
export const MIN_USEFUL_CHARS = 40

/** Mirrors the server-side cap in netlify/shared/gate.ts. */
export const MAX_QUERY_CHARS = 500

export function createAgents(): Record<AgentRole, AgentState> {
  return AGENT_ORDER.reduce(
    (acc, role) => {
      acc[role] = {
        id: role,
        name: AGENT_META[role].name,
        description: AGENT_META[role].description,
        status: 'idle',
        output: '',
        maxTokens: 0,
        detail: 'Waiting to start.',
        finish: null,
        reasoningTokens: 0,
      }
      return acc
    },
    {} as Record<AgentRole, AgentState>,
  )
}

export function hasUsefulOutput(agent: AgentState): boolean {
  return agent.output.trim().length >= MIN_USEFUL_CHARS
}

/** True when the stage was cut off mid-answer rather than finishing cleanly. */
export function wasTruncated(agent: AgentState): boolean {
  return agent.finish === 'length' || agent.finish === 'timeout'
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
