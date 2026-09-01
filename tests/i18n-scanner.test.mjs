import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("i18n-kontrollen scanner filer uden rg i PATH", () => {
  const result = spawnSync(process.execPath, ["scripts/check-i18n-coverage.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PATH: "/usr/bin:/bin" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Scanner: node/);
  const scanned = result.stdout.match(/Scanned TSX files: (\d+)/);
  assert.ok(scanned && Number(scanned[1]) > 0, "Node-fallbacken skal scanne TSX-filer");
});
