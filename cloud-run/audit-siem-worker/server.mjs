import http from "node:http";
import { deliverAuditBatch, safeSecretEqual, signRetentionCertificate, verifyAuditArchive } from "./siem.mjs";

const port = Number(process.env.PORT || 8080);

function authorized(request) {
  const expected = process.env.WORKER_SHARED_SECRET?.trim();
  if (!expected) return true; // Cloud Run IAM is the primary production control.
  return safeSecretEqual(request.headers["x-worker-shared-secret"], expected);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== "POST" || !request.url?.startsWith("/")) {
    response.writeHead(404).end(); return;
  }
  if (!authorized(request)) {
    response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: "unauthorized" })); return;
  }
  const path = new URL(request.url, "http://worker.internal").pathname;
  const action = path === "/run" ? deliverAuditBatch
    : path === "/verify" ? verifyAuditArchive
      : path === "/sign-retention" ? signRetentionCertificate : null;
  if (!action) { response.writeHead(404).end(); return; }
  try {
    const result = await action();
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ severity: "ERROR", event: "audit_worker_request_failed", path,
      code: error instanceof Error ? error.message : "unknown_error" }));
    response.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: "worker_failed" }));
  }
});
server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ severity: "INFO", event: "audit_worker_listening", port })));
