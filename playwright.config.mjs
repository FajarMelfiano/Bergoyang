import { defineConfig, devices } from '@playwright/test';

/**
 * E2E end-to-end: Vite dev (:5173) mem-proxy /api ke server.js (:3000).
 * Serial (workers: 1) karena semua test berbagi state server yang sama.
 * Data diisolasi lewat RL_DATA_DIR=/tmp/bergoyang-e2e saat start bersih;
 * kalau server dev sudah berjalan (reuseExistingServer), test memakai judul
 * unik sehingga toleran terhadap data lama.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // seed kredensial kredibel dulu (no-op kalau state sudah ada), lalu start API
      command:
        'sh -c "node scripts/seed_users.js --file e2e/fixtures/users.json --admin admin >/dev/null 2>&1; node server.js"',
      url: 'http://localhost:3000/api/state',
      reuseExistingServer: true,
      timeout: 30_000,
      env: { RL_DATA_DIR: '/tmp/bergoyang-e2e' },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
