import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const routes = [
  ["member-contracts", "/portal/mine-kontrakter"],
  ["member-works", "/portal/mine-vaerker"],
  ["admin-contracts", "/admin/kontrakter"],
  ["admin-works", "/admin/vaerker"],
  ["member-dashboard", "/portal"],
  ["contract-reviews", "/admin/kontraktgennemgang"],
  ["admin-producers", "/admin/producenter"],
] as const;

// GitHub-hosted runners vary noticeably while Chromium and the local Supabase
// stack share the same machine. Keep this below the fixed 3 s completed-list
// SLA, but leave enough headroom that first-paint noise does not block unrelated
// pull requests.
const DESKTOP_INITIAL_RENDER_LIMIT_MS = 1_750;

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
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await page.goto(path);
    await page.locator(`[data-performance-route="${routeName}"][data-performance-ready="first-row"]`).first().waitFor({ state: "attached" });

    const samples: Array<{ firstRowMs: number; completeMs: number; requestCount: number; bytes: number }> = [];
    for (let index = 0; index < 3; index += 1) {
      let requestCount = 0;
      let bytes = 0;
      const responseHandler = () => {
        requestCount += 1;
      };
      const loadingFinishedHandler = (event: { encodedDataLength: number }) => {
        bytes += event.encodedDataLength;
      };
      page.on("response", responseHandler);
      cdp.on("Network.loadingFinished", loadingFinishedHandler);
      const started = performance.now();
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}perf=${index}`);
      await page.locator(`[data-performance-route="${routeName}"][data-performance-ready="first-row"]`).first().waitFor({ state: "attached" });
      const firstRowMs = performance.now() - started;
      await page.locator(`[data-performance-route="${routeName}"][data-performance-ready="complete"]`).first().waitFor({ state: "attached" });
      samples.push({ firstRowMs, completeMs: performance.now() - started, requestCount, bytes });
      page.off("response", responseHandler);
      cdp.off("Network.loadingFinished", loadingFinishedHandler);
    }
    samples.sort((left, right) => left.firstRowMs - right.firstRowMs);
    const median = samples[1];
    const mobile = testInfo.project.name === "mobile-4g";
    // Første-række-tiden ligger lokalt langt under grænsen; tillad bundet CI
    // browser-/runner-varians (samme margin som filter-scenarierne nedenfor),
    // mens den faste 3 s SLA for den komplette liste holdes uændret.
    expect(median.firstRowMs).toBeLessThan(mobile ? 2_500 : DESKTOP_INITIAL_RENDER_LIMIT_MS);
    expect(median.completeMs).toBeLessThan(mobile ? 4_000 : 3_000);
    await mkdir("performance-report/results", { recursive: true });
    await writeFile(`performance-report/results/${testInfo.project.name}-${routeName}.json`, JSON.stringify({ routeName, project: testInfo.project.name, median, samples }, null, 2));
    await testInfo.attach("performance", { body: JSON.stringify({ median, samples }, null, 2), contentType: "application/json" });
  });
}

for (const [scenario, query] of [
  ["search", "?q=a"],
  ["filter", "?status=missingContract"],
  ["pagination", "?page=2&pageSize=20"],
] as const) {
  test(`member-works ${scenario} holder performancegrænser`, async ({ page }, testInfo) => {
    const path = `/portal/mine-vaerker${query}`;
    const samples: Array<{ firstRowMs: number; completeMs: number; requestCount: number; bytes: number }> = [];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");

    for (let index = 0; index < 3; index += 1) {
      let requestCount = 0;
      let bytes = 0;
      const responseHandler = () => { requestCount += 1; };
      const loadingFinishedHandler = (event: { encodedDataLength: number }) => { bytes += event.encodedDataLength; };
      page.on("response", responseHandler);
      cdp.on("Network.loadingFinished", loadingFinishedHandler);
      const separator = path.includes("?") ? "&" : "?";
      const started = performance.now();
      await page.goto(`${path}${separator}perf=${index}`);
      await page.locator('[data-performance-route="member-works"][data-performance-ready="first-row"]').first().waitFor({ state: "attached" });
      const firstRowMs = performance.now() - started;
      await page.locator('[data-performance-route="member-works"][data-performance-ready="complete"]').first().waitFor({ state: "attached" });
      samples.push({ firstRowMs, completeMs: performance.now() - started, requestCount, bytes });
      page.off("response", responseHandler);
      cdp.off("Network.loadingFinished", loadingFinishedHandler);
    }

    samples.sort((left, right) => left.firstRowMs - right.firstRowMs);
    const median = samples[1];
    const mobile = testInfo.project.name === "mobile-4g";
    await mkdir("performance-report/results", { recursive: true });
    await writeFile(`performance-report/results/${testInfo.project.name}-member-works-${scenario}.json`, JSON.stringify({ routeName: "member-works", scenario, project: testInfo.project.name, median, samples }, null, 2));
    // The local database stages remain well below 600 ms. Allow bounded CI
    // browser/runner variance while preserving the fixed 3 s completed-list SLA.
    expect(median.firstRowMs).toBeLessThan(mobile ? 2_500 : DESKTOP_INITIAL_RENDER_LIMIT_MS);
    expect(median.completeMs).toBeLessThan(mobile ? 4_000 : 3_000);
  });
}

test("organisation settings indlæser grunddata før tekstskabeloner", async ({ page }, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const samples: Array<{ shellMs: number; textsMs: number; requestCount: number; bytes: number }> = [];
  for (let index = 0; index < 3; index += 1) {
    let requestCount = 0;
    let bytes = 0;
    const responseHandler = () => { requestCount += 1; };
    const loadingFinishedHandler = (event: { encodedDataLength: number }) => { bytes += event.encodedDataLength; };
    page.on("response", responseHandler);
    cdp.on("Network.loadingFinished", loadingFinishedHandler);
    const started = performance.now();
    await page.goto(`/admin/organisation?perf=${index}`);
    await page.locator('[data-performance-route="organisation-settings"][data-performance-ready="shell"]').waitFor({ state: "attached" });
    const shellMs = performance.now() - started;
    await page.locator("[data-organisation-text-editor-anchor]").scrollIntoViewIfNeeded();
    await page.locator('[data-performance-route="organisation-settings"][data-performance-ready="texts"]').waitFor({ state: "attached" });
    samples.push({ shellMs, textsMs: performance.now() - started, requestCount, bytes });
    page.off("response", responseHandler);
    cdp.off("Network.loadingFinished", loadingFinishedHandler);
  }
  samples.sort((left, right) => left.shellMs - right.shellMs);
  const median = samples[1];
  const mobile = testInfo.project.name === "mobile-4g";
  // Shell-tiden ligger lokalt langt under grænsen; tillad bundet CI-varians
  // (samme margin som listesiderne), mens den faste 3 s SLA for tekstskabeloner
  // holdes uændret.
  expect(median.shellMs).toBeLessThan(mobile ? 2_500 : DESKTOP_INITIAL_RENDER_LIMIT_MS);
  expect(median.textsMs).toBeLessThan(mobile ? 4_000 : 3_000);
  await mkdir("performance-report/results", { recursive: true });
  await writeFile(`performance-report/results/${testInfo.project.name}-organisation-settings.json`, JSON.stringify({ routeName: "organisation-settings", project: testInfo.project.name, median, samples }, null, 2));
  await testInfo.attach("performance", { body: JSON.stringify({ median, samples }, null, 2), contentType: "application/json" });
});
