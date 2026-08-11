import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { startAdminDriveImport, waitForAdminDriveImport } from "../lib/client/admin-drive-import";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("starter en organisationsafgrænset importkilde gennem det eksisterende endpoint", async () => {
  let request: { url: string; method?: string } | null = null;
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), method: init?.method };
    return Response.json({ runId: "run-1", status: "processing", resumed: true }, { status: 202 });
  }) as typeof fetch;

  const result = await startAdminDriveImport("source/1");

  assert.deepEqual(request, { url: "/api/admin/import-sources/source%2F1/sync", method: "POST" });
  assert.deepEqual(result, { runId: "run-1", status: "processing", resumed: true });
});

test("venter på den valgte kørsel og returnerer de endelige importtal", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ run: calls === 1 ? {
      id: "run-1", status: "processing", discovered_count: 3, imported_count: 1,
      duplicate_count: 0, failed_count: 0, last_error: null,
    } : {
      id: "run-1", status: "completed", discovered_count: 3, imported_count: 2,
      duplicate_count: 1, failed_count: 0, last_error: null,
    } });
  }) as typeof fetch;

  const result = await waitForAdminDriveImport("source-1", "run-1", { attempts: 2, intervalMs: 0 });

  assert.equal(calls, 2);
  assert.equal(result?.status, "completed");
  assert.equal(result?.imported_count, 2);
  assert.equal(result?.duplicate_count, 1);
});

test("viser serverens sikre fejl når Drive-importen ikke kan startes", async () => {
  globalThis.fetch = (async () => Response.json({ error: "Baggrundsimport er ikke konfigureret" }, { status: 503 })) as typeof fetch;

  await assert.rejects(() => startAdminDriveImport("source-1"), /Baggrundsimport er ikke konfigureret/);
});
