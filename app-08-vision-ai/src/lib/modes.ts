import type { AnalysisMode } from './api'

export const MODES: Array<{ id: AnalysisMode; label: string; hint: string }> = [
  { id: 'describe', label: 'Describe', hint: 'A full description of the scene, subjects, and mood.' },
  { id: 'analyze', label: 'Analyze', hint: 'Composition, color, objects, visible text, and image quality.' },
  { id: 'qa', label: 'Question', hint: 'One answer to a question you type about the image.' },
  { id: 'extract', label: 'Extract', hint: 'Text, numbers, and tables, kept in their original structure.' },
]

export const MODE_LABELS: Record<AnalysisMode, string> = {
  describe: 'Describe',
  analyze: 'Analyze',
  qa: 'Question',
  extract: 'Extract',
}
