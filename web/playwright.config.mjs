import { defineConfig } from 'playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL: process.env.MAP_TEST_URL || 'http://127.0.0.1:3013',
    channel: process.platform === 'win32' ? 'chrome' : undefined,
    navigationTimeout: 120000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.MAP_TEST_URL ? undefined : {
    command: 'node node_modules/next/dist/bin/next dev -p 3013',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    url: 'http://127.0.0.1:3013',
    reuseExistingServer: true,
    timeout: 240000,
  },
});
