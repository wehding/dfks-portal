import { createServer } from "node:http";

import { FatalProcessingError, processOne } from "./processor.mjs";

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end("ok");
    return;
  }
  if (request.method !== "POST" || request.url !== "/run") {
    response.writeHead(404).end();
    return;
  }
  try {
    const result = await processOne();
    if (result.outcome === "empty") {
      response.writeHead(204, { "Cache-Control": "no-store" }).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ outcome: result.outcome }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "document_job_fatal",
      code: error instanceof FatalProcessingError ? error.code : "unexpected_failure",
    }));
    response.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "processing_failed" }));
  }
}).listen(Number(process.env.PORT || 8080));
