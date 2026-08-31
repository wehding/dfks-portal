import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Codex and Claude use the same canonical coding rules", () => {
  const result = spawnSync(process.execPath, ["scripts/check-agent-rules.mjs", "--strict"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Codex and Claude aligned/);
});
