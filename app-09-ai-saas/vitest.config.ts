import { defineConfig } from 'vitest/config'

// Tests never reach a real provider: the key is blanked here, and the server smoke
// tests set the placeholder they need explicitly and restore it afterwards.
export default defineConfig({
  // The Try it page test renders the real Dashboard, so tests may be .tsx.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    env: {
      OPENROUTER_API_KEY: '',
    },
  },
})
