// E2E: serves the repo as static files (like GitHub Pages) and drives it in real browsers.
// Run: npm run test:e2e   (needs Google Chrome installed; `npx playwright install webkit` for the iPhone project)
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8766;

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/report' }]],
  outputDir: 'tests/results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    // Google Chrome (has H.264): the real export path used by most desktop users.
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    // Android phone: mobile viewport, touch, Android UA.
    { name: 'android-chrome', use: { ...devices['Pixel 7'], channel: 'chrome' } },
    // iPhone: Safari's engine (WebKit) with iPhone viewport + UA.
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
  ],
});
