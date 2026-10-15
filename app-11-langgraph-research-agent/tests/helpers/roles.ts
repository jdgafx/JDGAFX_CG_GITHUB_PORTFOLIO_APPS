import { CRITIC_SYSTEM, planSystem } from '../../netlify/shared/graph/prompts'

/** The plan prompt the scripts here run without a web search key. */
const PLAN_SYSTEM = planSystem(false)

export type Role = 'plan' | 'agent' | 'draft' | 'critic'

/**
 * Every node uses the same model, so a request's node is told apart by its shape: the agent sends
 * tools, and the plan and the critic open with their own system prompt (followed by the date line). Anything else is the draft.
 */
export function roleOf(request: { tools?: unknown; messages: ReadonlyArray<{ content: string | null }> }): Role {
  if (request.tools) return 'agent'
  const system = request.messages[0]?.content ?? ''
  if (system.startsWith(PLAN_SYSTEM)) return 'plan'
  return system.startsWith(CRITIC_SYSTEM) ? 'critic' : 'draft'
}
