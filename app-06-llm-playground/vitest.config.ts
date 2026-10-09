import { defineConfig } from 'vitest/config'

// Tests never reach a real provider: the provider key is blanked here, and the server smoke
// tests set the placeholder they need explicitly and restore it afterwards.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      OPENROUTER_API_KEY: '',
    },
  },
})
