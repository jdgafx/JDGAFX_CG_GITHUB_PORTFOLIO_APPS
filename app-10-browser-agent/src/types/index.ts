export type StepAction = 'navigate' | 'find' | 'click' | 'type' | 'extract' | 'verify'

export interface BotStep {
  action: StepAction
  target: string
  value?: string
  thought: string
  url?: string
  pageContent?: string
}

export type SpeedMode = 'slow' | 'normal' | 'fast'
