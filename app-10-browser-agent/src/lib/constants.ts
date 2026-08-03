import { Globe, Search, MousePointer2, Keyboard, Download, CheckCircle2 } from 'lucide-react'
import type { SpeedMode, StepAction } from '../types'

export const PRESETS = [
  'Find cheapest flight NYC to LA next Friday',
  'Extract product data from e-commerce page',
  'Fill out job application form',
  'Compare prices across 3 online stores',
  'Book a restaurant reservation for Saturday 7pm',
]

export const ACTION_META: Record<StepAction, { icon: typeof Globe; label: string; color: string }> = {
  navigate: { icon: Globe, label: 'Navigate', color: '#14b8a6' },
  find: { icon: Search, label: 'Find', color: '#06b6d4' },
  click: { icon: MousePointer2, label: 'Click', color: '#8b5cf6' },
  type: { icon: Keyboard, label: 'Type', color: '#f59e0b' },
  extract: { icon: Download, label: 'Extract', color: '#10b981' },
  verify: { icon: CheckCircle2, label: 'Verify', color: '#14b8a6' },
}

export const SPEED_DELAYS: Record<SpeedMode, number> = {
  slow: 4000,
  normal: 2500,
  fast: 1200,
}

export const SPEED_HINTS: Record<SpeedMode, string> = {
  slow: 'Slow — 4s per step, easiest to follow',
  normal: 'Normal — 2.5s per step',
  fast: 'Fast — 1.2s per step',
}

/** How often the step scheduler re-reads the speed setting, so mid-step changes apply. */
export const SPEED_POLL_MS = 100

/** Preferred per-character delay for the typing animations, before the step budget is applied. */
export const BASE_TYPING_MS: Record<SpeedMode, number> = {
  slow: 90,
  normal: 60,
  fast: 30,
}

/** Share of a step's delay that a typing animation is allowed to occupy. */
export const TYPING_BUDGET = 0.7
export const MIN_TYPING_MS = 8

/** Resting cursor position per action type, in percent of the viewport box. */
export const CURSOR_ANCHORS: Record<StepAction, { x: number; y: number }> = {
  navigate: { x: 50, y: 30 },
  find: { x: 40, y: 45 },
  click: { x: 55, y: 55 },
  type: { x: 42, y: 42 },
  extract: { x: 60, y: 65 },
  verify: { x: 50, y: 50 },
}

export const MAX_RESULT_ROWS = 5
