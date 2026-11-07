/** The real questions the live checks ask. Questions of your own go in AGENTFLOW_EXTRA_QUESTIONS, separated by "|". */
export const REAL_QUESTIONS = [
  // The question that returned "No sources found" in T-003: Wikipedia was asked for all eight topic words at once.
  'In two sentences, compare SSE and WebSockets for streaming LLM output.',
  'SSE vs WebSockets',
  // Fifteen words; most of the topic words come after word eight.
  'Hey, quick question for you: why would anyone choose Rust over Go for building command line tools?',
  // Something from the last month.
  'What are the biggest AI announcements from the last month?',
]

export const EXTRA_QUESTIONS = (process.env.AGENTFLOW_EXTRA_QUESTIONS ?? '')
  .split('|')
  .map(question => question.trim())
  .filter(Boolean)
