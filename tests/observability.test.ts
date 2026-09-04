import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeRoute, sanitiseAnalyticsEvent, sanitiseRuntimeMessage, sanitiseSpeedEvent } from "../lib/observability/privacy";
import { parseDrainBody, sanitiseDrainEvents, sanitiseRuntimeLogs } from "../lib/observability/ingestion";
import { signPayload, verifyPayloadSignature } from "../lib/observability/signatures";

test("fjerner query, fragment og personhenførbare rutesegmenter", () => {
  assert.equal(normalizeRoute("https://portal.test/admin/kontrakter/8a5f1d7e-86f5-4f16-99cb-3e7af329ea64?member=secret#x"), "/admin/kontrakter/[id]");
  assert.equal(normalizeRoute("/portal/mine-vaerker/12345?q=navn"), "/portal/mine-vaerker/[id]");
  assert.equal(sanitiseAnalyticsEvent({ url: "/portal?email=a@b.dk" })?.url, "/portal");
});

test("Speed Insights tillader kun aftalte, normaliserede nøglesider", () => {
  assert.equal(sanitiseSpeedEvent({ url: "/admin/kontrakter?status=open" })?.url, "/admin/kontrakter");
  assert.equal(sanitiseSpeedEvent({ url: "/admin/rettighedshavere/secret" }), null);
});

test("signaturkontrol er deterministisk og afviser ændret body", () => {
  const body = JSON.stringify({ safe: true });
  const signature = signPayload(body, "test-secret", "sha1");
  assert.equal(verifyPayloadSignature(body, signature, "test-secret", "sha1"), true);
  assert.equal(verifyPayloadSignature(`${body}x`, signature, "test-secret", "sha1"), false);
});

test("drain parser accepterer både JSON-array og NDJSON uden at bevare rå URL", () => {
  const array = parseDrainBody(JSON.stringify([{ type: "pageview", url: "/portal?name=Steen", id: "a", timestamp: "2026-09-04T00:00:00Z" }]));
  const events = sanitiseDrainEvents(array);
  assert.equal(events.length, 1);
  assert.equal(events[0].route, "/portal");
  assert.doesNotMatch(JSON.stringify(events), /Steen/);
});

test("drain parser accepterer Vercels officielle Speed Insights v1-format", () => {
  const [event] = sanitiseDrainEvents([{
    schema: "vercel.speed_insights.v1",
    timestamp: "2026-09-04T10:00:00.000Z",
    metricType: "LCP",
    value: 1.75,
    path: "/admin/kontrakter",
    deviceType: "desktop",
  }]);

  assert.equal(event?.source, "vercel_speed_insights");
  assert.equal(event?.metricName, "LCP");
  assert.equal(event?.route, "/admin/kontrakter");
  assert.equal(event?.deviceClass, "desktop");
});

test("runtimefejl redigerer mail, id, token og URL", () => {
  const safe = sanitiseRuntimeMessage("Fejl for x@y.dk 8a5f1d7e-86f5-4f16-99cb-3e7af329ea64 https://secret.test/path eyJabcdefghijklmnopqrstuvwxyz1234567890");
  assert.equal(safe, "Fejl for [email] [id] [url] [token]");
  const events = sanitiseRuntimeLogs([{ rowId: "1", level: "error", message: safe!, requestPath: "/admin/kontrakter/123", responseStatusCode: 500 }], "deployment");
  assert.equal(events[0].route, "/admin/kontrakter/[id]");
  assert.equal(events[0].statusCode, 500);
  assert.equal(events[0].errorSummary, "Serveren returnerede HTTP 500");
  assert.doesNotMatch(JSON.stringify(events), /x@y\.dk|8a5f1d7e/);
});

test("Insights forklarer kilder, perioder, målinger og manglende data", async () => {
  const source = await readFile(new URL("../components/admin/insights-dashboard.tsx", import.meta.url), "utf8");
  for (const text of ["Mangler data", "Datagrundlag og teknik", "Kilde:", "Periode:", "Antal målinger:", "Anbefaling:", "Vercel Web Analytics", "GitHub Actions", "Vercel Runtime Logs", "DFKS auditlog"]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
