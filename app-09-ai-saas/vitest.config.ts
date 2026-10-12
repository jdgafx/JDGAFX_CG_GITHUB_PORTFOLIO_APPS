import { defineConfig } from 'vitest/config'

// Two projects: pure code and the Netlify functions run in node; React components,
// src/ and the browser clients run in jsdom. Tests never reach a real provider:
// the key is blanked here.
const env = { OPENROUTER_API_KEY: '' }

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          env,
          include: [
            'tests/*.test.{ts,tsx}',
            'tests/shared/**/*.test.{ts,tsx}',
            'tests/netlify/**/*.test.{ts,tsx}',
            'shared/**/*.test.{ts,tsx}',
            'netlify/**/*.test.{ts,tsx}',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          env,
          include: [
            'tests/components/**/*.test.{ts,tsx}',
            'tests/lib/**/*.test.{ts,tsx}',
            'tests/ui/**/*.test.{ts,tsx}',
            'src/**/*.test.{ts,tsx}',
          ],
        },
      },
    ],
  },
})
