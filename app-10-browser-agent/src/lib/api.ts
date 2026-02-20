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
  return data.steps
}
