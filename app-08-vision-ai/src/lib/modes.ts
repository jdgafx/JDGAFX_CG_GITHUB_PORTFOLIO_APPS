import type { AnalysisMode } from './api'

// Each hint says what the mode asks the model for, in one line. It shows under the mode's label.
export const MODES: Array<{ id: AnalysisMode; label: string; hint: string }> = [
  { id: 'describe', label: 'Describe', hint: 'Asks for the scene, its subjects and its mood.' },
  { id: 'analyze', label: 'Analyze', hint: 'Asks for composition, color, objects and text.' },
  { id: 'qa', label: 'Question', hint: 'Asks for one answer to the question you type.' },
  { id: 'extract', label: 'Extract', hint: 'Asks for text, numbers and tables, as laid out.' },
]

export const MODE_LABELS = Object.fromEntries(MODES.map(mode => [mode.id, mode.label])) as Record<AnalysisMode, string>
