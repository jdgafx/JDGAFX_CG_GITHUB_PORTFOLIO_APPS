import type { Tone } from './run'

// Each state shows one of these dots beside its word, so colour is never the only signal.
const TONE_DOT: Record<Tone, string> = {
  success: 'ds-dot--ok',
  warning: 'arena-dot--warn',
  danger: 'ds-dot--failed',
  accent: 'ds-dot--running',
  muted: 'ds-dot--skipped',
}

export function toneDot(tone: Tone): string {
  return TONE_DOT[tone]
}
