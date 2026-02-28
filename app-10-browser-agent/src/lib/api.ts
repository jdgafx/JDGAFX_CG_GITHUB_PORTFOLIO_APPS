import type { BotStep } from '../types'

export async function generateScenario(task: string): Promise<BotStep[]> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  const data = await response.json() as { steps: BotStep[] }

  if (!Array.isArray(data.steps)) throw new Error('Invalid response format')

  const validActions = ['navigate', 'find', 'click', 'type', 'extract', 'verify']
  const steps = data.steps.filter((s: any) =>
    s && typeof s.action === 'string' && validActions.includes(s.action) &&
    typeof s.target === 'string' && typeof s.thought === 'string'
  )

  if (steps.length === 0) throw new Error('No valid steps generated')

  return steps
}
