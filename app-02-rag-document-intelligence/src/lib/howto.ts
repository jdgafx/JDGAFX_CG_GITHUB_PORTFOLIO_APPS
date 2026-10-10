/** The "How to use" copy. Control names match the labels on screen. */
export const HOWTO_WHAT = 'Ask a document a question and see the exact sentences the answer comes from.'

export const HOWTO_STEPS = [
  'Pick a source: Wikipedia, arXiv or Upload, then choose a document.',
  'Type your question and press Ask.',
  'Click a citation such as [1] to read the sentence behind it. Answers take a few seconds.',
] as const

/** Try it fetches this article live from Wikipedia, then asks the question about it. */
export const TRY_ARTICLE = 'Photosynthesis'
export const TRY_QUESTION = 'Where in the cell does photosynthesis happen, and what does it produce?'
