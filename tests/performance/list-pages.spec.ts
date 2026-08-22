import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const routes = [
  ["member-contracts", "/portal/mine-kontrakter"],
  ["member-works", "/portal/mine-vaerker"],
  ["admin-contracts", "/admin/kontrakter"],
  ["admin-works", "/admin/vaerker"],
] as const;

async function login(page: Page) {
  await page.goto("/");
  await page.locator("#email").fill("performance@dfks.test");
  await page.locator("#password").fill("Performance-test-2026");
  await page.getByRole("button", { name: /log ind/i }).click();
  await page.waitForURL(/\/(admin|portal)/);
}

async function emulateMobile4g(cdp: CDPSession) {
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 80,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
    connectionType: "cellular4g",
  });
}

test.beforeEach(async ({ page, context }, testInfo) => {
  if (testInfo.project.name === "mobile-4g") {
    await emulateMobile4g(await context.newCDPSession(page));
  }
  await login(page);
});

for (const [routeName, path] of routes) {
  test(`${routeName} holder performancegrænser`, async ({ page }, testInfo) => {
    await page.goto(path);
    await page.locator(`[data-performance-route="${routeName}"][data-performance-ready="first-row"]`).first().waitFor({ state: "attached" });

    const samples: Array<{ firstRowMs: number; completeMs: number; requestCount: number; bytes: number }> = [];
    for (let index = 0; index < 3; index += 1) {
      let requestCount = 0;
      let bytes = 0;
      const responseHandler = (response: { headers(): Record<string, string> }) => {
        requestCount += 1;
        bytes += Number(response.headers()["content-length"] ?? 0);
      };
      page.on("response", responseHandler);
      const started = performance.now();
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}perf=${index}`);
      await page.locator(`[data-performance-route="${routeName}"][data-performance-ready="first-row"]`).first().waitFor({ state: "attached" });
      const firstRowMs = performance.now() - started;
      await page.locator(`[data-performance-route="${routeName}"][data-performance-ready="complete"]`).first().waitFor({ state: "attached" });
      samples.push({ firstRowMs, completeMs: performance.now() - started, requestCount, bytes });
      page.off("response", responseHandler);
    }
    samples.sort((left, right) => left.firstRowMs - right.firstRowMs);
    const median = samples[1];
    const mobile = testInfo.project.name === "mobile-4g";
    expect(median.firstRowMs).toBeLessThan(mobile ? 2_500 : 1_200);
    expect(median.completeMs).toBeLessThan(mobile ? 4_000 : 3_000);
    await mkdir("performance-report/results", { recursive: true });
    await writeFile(`performance-report/results/${testInfo.project.name}-${routeName}.json`, JSON.stringify({ routeName, project: testInfo.project.name, median, samples }, null, 2));
    await testInfo.attach("performance", { body: JSON.stringify({ median, samples }, null, 2), contentType: "application/json" });
  });
}
