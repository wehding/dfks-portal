import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: "performance-report/html", open: "never" }], ["json", { outputFile: "performance-report/playwright.json" }]],
  use: { baseURL: process.env.PERFORMANCE_BASE_URL ?? "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-4g", use: { ...devices["Pixel 7"] } },
  ],
});
