// The contract the page and the function share: pure constants and types, no server code,
// so the browser bundle can import this file directly.

// Sources is a live lookup with no model call. The other five are one model call each.
export const STAGE_IDS = ['sources', 'research', 'outline', 'draft', 'edit', 'polish'] as const
export type StageId = (typeof STAGE_IDS)[number]
export type ModelStageId = Exclude<StageId, 'sources'>

export const STAGE_LABELS: Record<StageId, string> = {
  sources: 'Sources',
  research: 'Research',
  outline: 'Outline',
  draft: 'Draft',
  edit: 'Edit',
  polish: 'Polish',
}

export const CONTENT_TYPES = ['Blog Post', 'Technical Article', 'Marketing Copy', 'Newsletter', 'Social Thread'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export type StageOutputs = Partial<Record<StageId, string>>

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost?: number
}

export interface TraceRow {
  name: string
  status: 'ok' | 'failed'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}
