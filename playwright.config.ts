import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests. By default against the dev server; with E2E_PREVIEW=1 against the production build served as
 * plain static files (`vite preview`, no API functions), which is what proves the tabulation needs no backend.
 * Locally the installed Chrome is used; CI installs Playwright's Chromium.
 */
const preview = process.env.E2E_PREVIEW === '1';
const PORT = preview ? 5182 : 5181;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:' + PORT,
    channel: process.env.CI ? undefined : 'chrome',
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: preview ? 'npm run build && npx vite preview --port ' + PORT + ' --strictPort' : 'npx vite --port ' + PORT + ' --strictPort',
    url: 'http://localhost:' + PORT + '/tabulacion',
    reuseExistingServer: !process.env.CI && !preview,
    timeout: 180_000,
  },
});
