import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;

/**
 * Browser tests (ADR 0016): the production build on `vite preview`, headless Chromium with
 * software WebGL2, synthetic data. `pnpm e2e` builds first.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // 127.0.0.1 rather than localhost: a service worker another project left on localhost can
    // answer for this origin on a developer's machine.
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 1000 },
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
  },
});
