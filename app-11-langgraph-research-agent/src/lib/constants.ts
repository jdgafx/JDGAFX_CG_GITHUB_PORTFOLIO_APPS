export interface SampleQuestion {
  label: string
  question: string
  /** What path through the graph to expect. Said as "usually", because the models decide. */
  path: string
}

/**
 * The built-in questions, each aimed at a different path. All have a plain answer on English Wikipedia:
 * Expo '98 (1998, "The Oceans: A Heritage for the Future"); Philip K. Dick's 1968 novel behind Blade Runner;
 * the Eiffel Tower (1889) and the Empire State Building (1931), 42 years apart.
 */
export const SAMPLE_QUESTIONS: SampleQuestion[] = [
  {
    label: 'Quick lookup',
    question: 'In what year did Lisbon host a World Exposition, and what was its theme?',
    path: 'Usually one search, one page read, and a draft the critic accepts.',
  },
  {
    label: 'Follow a link',
    question: 'Who wrote the novel that the film Blade Runner is based on, and in what year was the novel first published?',
    path: 'Usually two tool rounds: find the film, then read the novel behind it.',
  },
  {
    label: 'Critic pushback',
    question: 'Which was completed first, the Eiffel Tower or the Empire State Building, and how many years apart?',
    path: 'Two pages and a sum. The critic often sends the draft back for a revision.',
  },
]

export const QUESTION_MAX_CHARS = 500

/** The loop limits the server enforces. The page cannot import server code, so a test keeps these equal to the server's. */
export const MAX_TOOL_ROUNDS = 4
export const MAX_REVISIONS = 2
