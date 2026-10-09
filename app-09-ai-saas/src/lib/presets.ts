/** One-click comparisons. Each is a plain list of npm names, so a preset is no different from picking the packages by hand. */
export interface Preset {
  label: string
  names: string[]
}

export const PRESETS: Preset[] = [
  { label: 'React vs Vue vs Svelte', names: ['react', 'vue', 'svelte'] },
  { label: 'Vite vs webpack vs esbuild', names: ['vite', 'webpack', 'esbuild'] },
  { label: 'Vitest vs Jest vs Mocha', names: ['vitest', 'jest', 'mocha'] },
  { label: 'Prisma vs Drizzle vs TypeORM', names: ['prisma', 'drizzle-orm', 'typeorm'] },
  { label: 'OpenAI vs Anthropic SDKs', names: ['openai', '@anthropic-ai/sdk'] },
]

export const DEFAULT_NAMES = PRESETS[0].names

/** The window choices, in days. */
export const WINDOWS = [30, 90, 365] as const
export const DEFAULT_WINDOW = 30
