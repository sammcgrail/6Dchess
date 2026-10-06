import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/chess/`,
    viewport: { width: 1400, height: 900 },
    launchOptions: {
      // Software WebGL so Three.js renders in headless CI
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [
    { name: 'chromium' },
    // Real WebKit on an iPhone profile for mobile layout checks; CI installs WebKit and sets PW_WEBKIT
    ...(process.env.PW_WEBKIT
      ? [{ name: 'mobile-webkit', testMatch: /mobile\.spec\.ts/, use: { ...devices['iPhone 13'], launchOptions: {} } }]
      : []),
  ],
  webServer: {
    command: `node scripts/serve.js ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
