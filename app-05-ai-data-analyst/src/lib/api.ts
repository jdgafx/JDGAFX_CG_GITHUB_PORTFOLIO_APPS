import type { QueryPlan } from '../types'

interface AskDataRequest {
  question: string
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
}

export async function askData(request: AskDataRequest): Promise<QueryPlan> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Request failed' }))
    const errObj = errorBody as { error?: string }
    throw new Error(errObj.error ?? `HTTP ${response.status}`)
  }

  const queryPlan = (await response.json()) as QueryPlan
  return queryPlan
}
