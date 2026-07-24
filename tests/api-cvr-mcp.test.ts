import test from "node:test";
import assert from "node:assert/strict";
import { apiCvrNameMatchScore, parseMcpEventResponse } from "../lib/api-cvr-mcp";

test("parser apiCVR MCP SSE-svar", () => {
  const parsed = parseMcpEventResponse('event: message\ndata: {"result":{"content":[{"type":"text","text":"[]"}]},"jsonrpc":"2.0","id":1}\n');
  assert.equal(parsed.result?.content?.[0]?.text, "[]");
});

test("rangerer eksakt og juridisk suffiks som sikre CVR-navnematches", () => {
  assert.equal(apiCvrNameMatchScore("A.FILM PRODUCTION", "A.FILM PRODUCTION"), 120);
  assert.equal(apiCvrNameMatchScore("A.FILM PRODUCTION A/S", "A.FILM PRODUCTION"), 110);
  assert.ok(apiCvrNameMatchScore("Nordisk Film Production Norge", "Nordisk Film Production A/S") < 105);
});
