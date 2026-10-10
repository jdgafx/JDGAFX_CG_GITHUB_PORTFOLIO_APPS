export interface ChartSummaryInput {
  chartType: string
  /** The measure and its grouping, as the title words: "total rain (mm) by month". */
  subject: string
  /** One total over all rows, or grouped. */
  total: boolean
  groups: number
  /** The total (one group) or the largest group, with its value already in the page's unit. */
  top: { label: string; value: string }
}

/** The chart's spoken summary, read as the label of the bar list. A total names its one number; groups name their count and the largest. */
export function chartSummary({ chartType, subject, total, groups, top }: ChartSummaryInput): string {
  if (total) return `${chartType} chart. ${subject}: ${top.value}.`
  return `${chartType} chart. ${subject}, across ${groups} groups. Largest: ${top.label} at ${top.value}.`
}
