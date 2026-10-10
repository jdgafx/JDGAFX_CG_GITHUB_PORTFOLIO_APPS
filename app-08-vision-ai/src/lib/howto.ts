import { COMMONS_PRESETS } from './commons'

/** The "How to use" copy. Control names match the labels on screen. */
export const HOWTO_WHAT = 'Ask a vision model about a picture: describe it, read its text, or compare two.'

export const HOWTO_STEPS = [
  'Choose file, paste a screenshot, or Pick a public image from Wikimedia Commons.',
  'Pick a mode: Describe, Analyze, Question or Extract.',
  'Press Analyze image. A run takes about 10 seconds.',
] as const

/** Try it searches Commons live with this preset, loads its first result and describes it. */
export const TRY_PRESET = COMMONS_PRESETS.find(preset => preset.id === 'street') ?? COMMONS_PRESETS[0]
