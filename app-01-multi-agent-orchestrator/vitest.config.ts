import { configDefaults, defineConfig } from 'vitest/config'

// Tests never reach a real provider: every key is blanked here, and the server smoke
// tests set the placeholder they need explicitly and restore it afterwards.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The live check reaches real services: `npm run test:live`.
    exclude: [...configDefaults.exclude, 'tests/live/**'],
    env: {
      OPENROUTER_API_KEY: '',
    },
  },
})
