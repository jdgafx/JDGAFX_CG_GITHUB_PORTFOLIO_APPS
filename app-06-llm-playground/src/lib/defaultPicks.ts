import type { Picks } from './run'

// The picker's starting models for panels B and C. Both must be curated IDs (see netlify/shared/curated.ts).
export const DEFAULT_PICKS: Picks = {
  B: 'google/gemini-2.5-flash-lite',
  C: 'anthropic/claude-sonnet-5.5',
}
