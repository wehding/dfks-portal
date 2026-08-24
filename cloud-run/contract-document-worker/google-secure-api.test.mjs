import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createGoogleOcrClient,
  extractDlpFindings,
  GOOGLE_OCR_INFO_TYPES,
  GoogleOcrOperationalError,
  maskSensitiveImageBytes,
  readGoogleConfig,
  secureJsonPost,
} from "./google-secure-api.mjs";

test("kun regionale EU-endpoints konfigureres", () => {
  const config = readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "eu", GOOGLE_DLP_LOCATION: "eu" });
  assert.equal(config.visionEndpoint, "https://eu-vision.googleapis.com");
  assert.equal(config.dlpEndpoint, "https://dlp.eu.rep.googleapis.com");
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "global" }));
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks\r\nx-evil: true" }));
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("PERSON_NAME"), false);
});

test("globale og asynkrone endpoints afvises før netværkskald", async () => {
  let called = false;
  await assert.rejects(() => secureJsonPost("https://vision.googleapis.com/v1/files:asyncBatchAnnotate", "token", {}, {
    requestImpl() { called = true; },
  }), /google_endpoint_rejected/);
  assert.equal(called, false);
});

test("DLP-fejl stopper siden før Vision", async () => {
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "eu",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url) => {
      if (url.includes("content:inspect")) throw new Error("dlp_unavailable");
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(() => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: Buffer.from("jpeg") }]), /dlp_unavailable/);
  assert.equal(visionCalled, false);
});

test("DLP-koordinater maskeres lokalt, og råbilledet sendes kun én gang til DLP", async () => {
  const calls = [];
  const raw = Buffer.from("raw-sensitive-image");
  const masked = Buffer.from("locally-masked-image");
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "eu",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    imageMasker: async (bytes, boxes) => {
      assert.equal(bytes, raw);
      assert.deepEqual(boxes, [{ top: 2, left: 3, width: 4, height: 5 }]);
      return masked;
    },
    jsonPost: async (url, _token, payload) => {
      calls.push({ url, payload });
      if (url.includes("content:inspect")) {
        return { result: { findings: [{
          infoType: { name: "DENMARK_CPR_NUMBER" },
          location: { contentLocations: [{ imageLocation: { boundingBoxes: [{ top: 2, left: 3, width: 4, height: 5 }] } }] },
        }] } };
      }
      return { responses: [{ fullTextAnnotation: { pages: [] } }] };
    },
  });
  const result = await client.redactAndAnnotate([{ pageNumber: 1, imageBytes: raw }]);
  assert.equal(calls.filter(({ url }) => url.includes("dlp.eu.rep.googleapis.com")).length, 1);
  assert.equal(calls.some(({ url }) => url.includes("image:redact")), false);
  assert.equal(calls[1].payload.requests[0].image.content, masked.toString("base64"));
  assert.deepEqual(result.redactionCounts, { DENMARK_CPR_NUMBER: 1 });
});

test("kendt DLP-fund uden koordinater stopper før Vision", async () => {
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "eu",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url) => {
      if (url.includes("content:inspect")) {
        return { result: { findings: [{ infoType: { name: "IBAN_CODE" }, location: {} }] } };
      }
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(() => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: Buffer.from("raw") }]), /dlp_location_missing/);
  assert.equal(visionCalled, false);
});

test("DLP-fund returnerer kun tællinger og ikke fundet tekst", () => {
  const result = extractDlpFindings({ result: { findings: [{
    quote: "hemmeligt-cpr",
    infoType: { name: "DENMARK_CPR_NUMBER" },
    location: { contentLocations: [{ imageLocation: { boundingBoxes: [{ top: 1, left: 2, width: 3, height: 4 }] } }] },
  }] } });
  assert.deepEqual(result, {
    counts: { DENMARK_CPR_NUMBER: 1 },
    boxes: [{ top: 1, left: 2, width: 3, height: 4 }],
  });
  assert.equal(JSON.stringify(result).includes("hemmeligt-cpr"), false);
});

test("lokal maskering ændrer billedet uden at skrive rådata til argumenter", async () => {
  const source = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAKAAoDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==", "base64");
  const output = await maskSensitiveImageBytes(source, [{ top: 1, left: 1, width: 5, height: 5 }]);
  assert.equal(output.subarray(0, 2).toString("hex"), "ffd8");
  assert.notDeepEqual(output, source);
});

test("Google-kald kræver TLS 1.3", async () => {
  let options;
  const requestImpl = (received, callback) => {
    options = received;
    const request = new EventEmitter();
    const socket = new EventEmitter();
    socket.getProtocol = () => "TLSv1.3";
    const response = new EventEmitter();
    response.statusCode = 200;
    request.end = () => {
      request.emit("socket", socket);
      socket.emit("secureConnect");
      callback(response);
      response.emit("data", Buffer.from("{}"));
      response.emit("end");
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
  await secureJsonPost("https://eu-vision.googleapis.com/v1/images:annotate", "short-lived", {}, { requestImpl });
  assert.equal(options.minVersion, "TLSv1.3");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.headers["x-goog-user-project"], undefined);
});

test("Google-kald sender kvoteprojekt uden at logge token", async () => {
  let options;
  const requestImpl = (received, callback) => {
    options = received;
    const request = new EventEmitter();
    const socket = new EventEmitter();
    socket.getProtocol = () => "TLSv1.3";
    const response = new EventEmitter();
    response.statusCode = 200;
    request.end = () => {
      request.emit("socket", socket);
      socket.emit("secureConnect");
      callback(response);
      response.emit("data", Buffer.from("{}"));
      response.emit("end");
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
  await secureJsonPost("https://eu-vision.googleapis.com/v1/images:annotate", "short-lived", {}, {
    requestImpl, quotaProject: "dfks-portal",
  });
  assert.equal(options.headers["x-goog-user-project"], "dfks-portal");
});

test("midlertidig Google-fejl prøves igen med afgrænset antal forsøg", async () => {
  let attempts = 0;
  const delays = [];
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "eu",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    retryDelay: async (milliseconds) => delays.push(milliseconds),
    jsonPost: async (url) => {
      attempts += 1;
      if (attempts < 3) throw new GoogleOcrOperationalError("google_api_503");
      if (url.includes("content:inspect")) return {};
      return { responses: [{ fullTextAnnotation: { pages: [] } }] };
    },
  });
  await client.redactAndAnnotate([{ pageNumber: 1, imageBytes: Buffer.from("raw") }]);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [250, 500]);
});
