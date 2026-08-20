import http from "node:http";
import { deliverAuditBatch, safeSecretEqual } from "./siem.mjs";

const port = Number(process.env.PORT || 8080);
const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/run") {
    response.writeHead(404).end();
    return;
  }
  const secret = process.env.WORKER_SHARED_SECRET;
  const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : "";
  if (!safeSecretEqual(bearer, secret)) {
    response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  try {
    const result = await deliverAuditBatch();
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error("[audit-siem-worker] delivery failed", error instanceof Error ? error.message : "unknown_error");
    response.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: "delivery_failed" }));
  }
});
server.listen(port, "0.0.0.0", () => console.log(`[audit-siem-worker] listening on ${port}`));
