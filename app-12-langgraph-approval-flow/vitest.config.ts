import { defineConfig } from 'vitest/config'

// Tests never reach a real provider or a real Blobs store: every key is blanked here, and the
// server smoke tests set the placeholder they need explicitly and restore it afterwards.
// NETLIFY_BLOBS_CONTEXT is blanked so a Blobs context leaking from the shell cannot be used.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      OPENROUTER_API_KEY: '',
      NETLIFY_BLOBS_CONTEXT: '',
    },
  },
})
