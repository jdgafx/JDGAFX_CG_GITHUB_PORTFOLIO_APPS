/** The "How to use" copy. Control names match the labels on screen. */
export const HOWTO_WHAT = 'Get a chart that answers your question, with the plan the model wrote for it.'

export const HOWTO_STEPS = [
  'Pick a Dataset, such as Earthquakes, past 7 days, or choose Upload CSV for your own.',
  'Type Your question and press Plan and run. A run takes a few seconds.',
  'Read the chart, then use Ask a follow-up to change it.',
] as const

/** Try it loads the live USGS week feed and asks this question about it. */
export const TRY_QUESTION = 'Which region had the most earthquakes?'
