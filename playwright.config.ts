import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3200";
const BASE_URL = `http://localhost:${PORT}`;

// Suite E2E isolée : base data/e2e.db (copie de app.db), build .next-e2e, serveur de production sur le port 3200.
// Relance : npm run test:e2e   (E2E_SKIP_BUILD=1 pour réutiliser le build)
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 1),
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "test-results/e2e-report", open: "never" }], ["json", { outputFile: "test-results/e2e-results.json" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    locale: "fr-FR",
    timezoneId: "Africa/Tunis",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: `${BASE_URL}/api/health`,
    // E2E_REUSE_SERVER=1 : réutilise un serveur déjà lancé par `node tests/e2e/server.mjs` (mise au point)
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 20 * 60_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
