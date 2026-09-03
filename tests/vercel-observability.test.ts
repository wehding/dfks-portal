import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("root-layoutet monterer Vercel Analytics og Speed Insights med de valgte integrationer", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8")

  assert.match(layout, /@vercel\/analytics\/react/)
  assert.match(layout, /@vercel\/speed-insights\/next/)
  assert.match(layout, /<Analytics\s*\/>/)
  assert.match(layout, /<SpeedInsights\s*\/>/)
})
