import { defineConfig } from 'vitest/config'

// The live check reaches real services, so `npm test` leaves it out. Run it with `npm run test:live`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 120_000,
    disableConsoleIntercept: true,
  },
})
