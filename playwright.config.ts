import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: "chrome",
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests",
      ],
    },
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer:
    process.env.PLAYWRIGHT_EXTERNAL_SERVERS === "1"
      ? undefined
      : [
          {
            command: "node server/dist/index.js",
            url: "http://127.0.0.1:3001/health",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
          {
            command: "node node_modules/vite/bin/vite.js --host 127.0.0.1",
            url: "http://127.0.0.1:1420",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            env: {
              VITE_API_URL: "http://127.0.0.1:3001",
              VITE_E2E_MEDIA: "1",
            },
          },
        ],
});
