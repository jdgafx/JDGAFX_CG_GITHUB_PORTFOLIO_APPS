import { CRITIC_SYSTEM, PLAN_SYSTEM } from '../../netlify/shared/graph/prompts'

export type Role = 'plan' | 'agent' | 'draft' | 'critic'

/**
 * Every node uses the same model, so a request's node is told apart by its shape: the agent sends
 * tools, and the plan and the critic open with their own system prompt. Anything else is the draft.
 */
export function roleOf(request: { tools?: unknown; messages: ReadonlyArray<{ content: string | null }> }): Role {
  if (request.tools) return 'agent'
  const system = request.messages[0]?.content
  if (system === PLAN_SYSTEM) return 'plan'
  return system === CRITIC_SYSTEM ? 'critic' : 'draft'
}
