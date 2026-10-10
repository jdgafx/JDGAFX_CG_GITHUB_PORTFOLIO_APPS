import { defineConfig } from 'vitest/config'

// Tests never reach a real provider: every key is blanked here, and the server smoke
// tests set the placeholder they need explicitly and restore it afterwards.
export default defineConfig({
  // The How to use render test imports a .tsx component.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    env: {
      OPENROUTER_API_KEY: '',
    },
  },
})
