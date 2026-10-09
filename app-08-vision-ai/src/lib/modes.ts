import type { AnalysisMode } from './api'

// Each hint says what the mode asks the model for, in one line. It shows under the mode's label.
export const MODES: Array<{ id: AnalysisMode; label: string; hint: string }> = [
  { id: 'describe', label: 'Describe', hint: 'Asks for the scene, its subjects and its mood.' },
  { id: 'analyze', label: 'Analyze', hint: 'Asks for composition, color, objects and text.' },
  { id: 'qa', label: 'Question', hint: 'Asks for one answer to the question you type.' },
  { id: 'extract', label: 'Extract', hint: 'Asks for text, numbers and tables, as laid out.' },
]

export const MODE_LABELS: Record<AnalysisMode, string> = {
  ...(Object.fromEntries(MODES.map(mode => [mode.id, mode.label])) as Record<'describe' | 'analyze' | 'qa' | 'extract', string>),
  region: 'Region',
  compare: 'Compare',
}

// The three things a visitor can ask about: the whole picture, a box drawn on it, or two pictures side by side.
export type Scope = 'whole' | 'region' | 'compare'

export const SCOPES: Array<{ id: Scope; label: string; hint: string }> = [
  { id: 'whole', label: 'Whole image', hint: 'Describe, analyze, ask or extract.' },
  { id: 'region', label: 'Region', hint: 'Draw a box and ask about that part.' },
  { id: 'compare', label: 'Compare', hint: 'Two images, side by side.' },
]

export function scopeOf(mode: AnalysisMode): Scope {
  return mode === 'region' ? 'region' : mode === 'compare' ? 'compare' : 'whole'
}
