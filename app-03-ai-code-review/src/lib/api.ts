import type { ReviewResult } from '../types'

export async function reviewCode(code: string, language: string): Promise<ReviewResult> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, language }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Network error' }))
    throw new Error((errorData as { error?: string }).error ?? `HTTP ${response.status}`)
  }

  const data = (await response.json()) as { success: boolean; data?: ReviewResult; error?: string }

  if (!data.success) {
    throw new Error(data.error ?? 'Review failed')
  }

  if (!data.data) {
    throw new Error('No review data returned')
  }

  return data.data
}
