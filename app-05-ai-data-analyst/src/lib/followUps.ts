import { lineNeedsOrder, pieIsCrowded } from './chartGeometry'
import { answerDirection } from './queryPlan'
import { labelFor, RAW_VOCABULARY, shownLabel } from './vocabulary'
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
  if (first && first !== '(blank)' && plan.groupBy !== 'date') ideas.push(`Only ${shownLabel(vocab, first)}`)

  if (plan.limit === undefined && labels.length > TOP_N && plan.chartType !== 'line' && plan.chartType !== 'area') {
    ideas.push(`Show the ${answerDirection(plan) === 'lowest' ? 'bottom' : 'top'} ${TOP_N}`)
  }

  const other = GROUPINGS.find((name) => name !== plan.groupBy && headers.includes(name))
  if (other) ideas.push(`Now by ${labelFor(vocab, other)}`)

  // A crowded pie, or a line over unordered names, already offers the bar chart under itself.
  const combine = plan.aggregate.fn === 'sum' || plan.aggregate.fn === 'count'
  const pieOffersBars =
    (plan.chartType === 'pie' && pieIsCrowded(labels, result.datasets[0]?.values ?? [], combine)) ||
    lineNeedsOrder(plan.chartType, labels)
  if (plan.chartType === 'bar') ideas.push('As a line chart')
  else if (!pieOffersBars) ideas.push('As a bar chart')
  return ideas.slice(0, MAX_IDEAS)
}
