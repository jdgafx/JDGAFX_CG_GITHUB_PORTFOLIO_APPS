import { answerDirection } from './queryPlan'
import { labelFor, RAW_VOCABULARY } from './vocabulary'
import type { AnalysisResult } from '../types'

const MAX_IDEAS = 4
const TOP_N = 5
/** Columns worth offering as a new grouping, in order of preference. */
const GROUPINGS = ['month', 'region', 'magType', 'type']

/**
 * Follow-ups worth offering after an answer, each a sentence the visitor can send as it stands.
 * They are built from the plan on screen, so every one changes something the page can show.
 */
export function followUpIdeas(result: AnalysisResult, headers: string[]): string[] {
  const { queryPlan: plan, labels } = result
  const vocab = result.vocab ?? RAW_VOCABULARY
  const ideas: string[] = []

  const first = labels[0]
  if (first && first !== '(blank)' && plan.groupBy !== 'date') ideas.push(`Only ${first}`)

  if (plan.limit === undefined && labels.length > TOP_N && plan.chartType !== 'line' && plan.chartType !== 'area') {
    ideas.push(`Show the ${answerDirection(plan) === 'lowest' ? 'bottom' : 'top'} ${TOP_N}`)
  }

  const other = GROUPINGS.find((name) => name !== plan.groupBy && headers.includes(name))
  if (other) ideas.push(`Now by ${labelFor(vocab, other)}`)

  ideas.push(plan.chartType === 'bar' ? 'As a line chart' : 'As a bar chart')
  return ideas.slice(0, MAX_IDEAS)
}
