import { defineConfig } from "@playwright/test";

/**
 * e2e smoke (v3 REP-2, K7): the production build on :3100 (never the developer's `next dev` on :3000; `next build`
 * writes .next while `next dev` keeps to .next/dev, so both can run side by side). Locally the installed Microsoft
 * Edge runs the suite (no `playwright install` needed); CI installs Playwright's Chromium.
 */
const CI = !!process.env.CI;
const PORT = 3100;
const touch = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: CI ? undefined : "msedge",
    locale: "ru-RU",
    trace: CI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { viewport: { width: 375, height: 812 }, ...touch } },
    { name: "landscape", use: { viewport: { width: 812, height: 375 }, ...touch } },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
