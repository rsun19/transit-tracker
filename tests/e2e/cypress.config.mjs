import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? 'http://127.0.0.1:3001',
    specPattern: 'tests/e2e/specs/**/*.cy.ts',
    supportFile: 'tests/e2e/support/e2e.ts',
    video: true,
    screenshotOnRunFailure: true,
    retries: {
      runMode: 1,
      openMode: 0,
    },
  },
});
