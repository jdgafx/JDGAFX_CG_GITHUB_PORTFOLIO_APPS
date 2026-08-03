import type { AgentRole, AgentState } from '../types'

export const AGENT_ORDER: AgentRole[] = ['researcher', 'analyst', 'critic', 'synthesizer']

export const AGENT_LABELS: Record<AgentRole, string> = {
  researcher: 'Research Findings',
  analyst: 'Analysis',
  critic: 'Critical Review',
  synthesizer: 'Final Synthesis',
}

export const AGENT_COLORS: Record<AgentRole, string> = {
  researcher: '#00d4ff',
  analyst: '#ffa500',
  critic: '#ff3366',
  synthesizer: '#00ff88',
}

export const AGENT_TOOLTIPS: Record<AgentRole, string> = {
  researcher: 'Researcher — gathers the key facts and figures on your topic',
  analyst: 'Analyst — finds the patterns across the research findings',
  critic: 'Critic — points out gaps and missing angles in the analysis',
  synthesizer: 'Synthesizer — combines everything into the final report',
}

export const AGENT_ACTIVITY: Record<AgentRole, { working: string; complete: string; idle: string }> = {
  researcher: {
    working: 'Gathering data, statistics, and key findings from multiple sources...',
    complete: 'Research complete — findings ready for analysis.',
    idle: 'Standing by to research your topic.',
  },
  analyst: {
    working: 'Analyzing research findings — identifying patterns, correlations, and insights...',
    complete: 'Analysis complete — structured insights ready for review.',
    idle: 'Waiting for research data to analyze.',
  },
  critic: {
    working: 'Reviewing analysis for gaps, biases, and missing perspectives...',
    complete: 'Critical review complete — feedback incorporated.',
    idle: 'Waiting for analysis to review.',
  },
  synthesizer: {
    working: 'Combining all findings into a polished, comprehensive final report...',
    complete: 'Synthesis complete — final report ready to download.',
    idle: 'Waiting for all agents to finish before synthesizing.',
  },
}

const AGENT_META: Record<AgentRole, { name: string; description: string }> = {
  researcher: { name: 'Research Agent', description: 'Gathers data & findings' },
  analyst: { name: 'Analyst Agent', description: 'Identifies patterns' },
  critic: { name: 'Critic Agent', description: 'Reviews for gaps' },
  synthesizer: { name: 'Synthesizer Agent', description: 'Produces final report' },
}

export const EXAMPLE_QUERIES = [
  'How is AI changing software engineering jobs?',
  'Is nuclear power a realistic path to net zero?',
  'What drives the rise of the creator economy?',
]

/** An agent needs at least this much text before its section counts as real output. */
export const MIN_USEFUL_CHARS = 40

/** Mirrors the server-side cap in netlify/functions/ai.ts. */
export const MAX_QUERY_CHARS = 500

/** Rough chars-per-token for the streaming progress estimate. */
export const CHARS_PER_TOKEN = 4

export function createAgents(): Record<AgentRole, AgentState> {
  return AGENT_ORDER.reduce(
    (acc, role) => {
      acc[role] = {
        id: role,
        name: AGENT_META[role].name,
        description: AGENT_META[role].description,
        status: 'idle',
        output: '',
        tokens: 0,
        reasoningTokens: 0,
        finish: null,
        maxTokens: 0,
      }
      return acc
    },
    {} as Record<AgentRole, AgentState>,
  )
}

export function hasUsefulOutput(agent: AgentState): boolean {
  return agent.output.trim().length >= MIN_USEFUL_CHARS
}

/** True when the agent was cut off mid-answer rather than finishing cleanly. */
export function wasTruncated(agent: AgentState): boolean {
  return agent.finish === 'length' || agent.finish === 'timeout'
}

/** Filename-safe slug; punctuation-only queries fall back to a usable name. */
export function slugifyQuery(query: string): string {
  const slug = query
    .slice(0, 40)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || 'untitled'
}

export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
