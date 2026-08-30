import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createGoogleOcrClient,
  decodeDlpRedactedImage,
  extractDlpFindings,
  GOOGLE_OCR_INFO_TYPES,
  GoogleOcrOperationalError,
  readGoogleConfig,
  secureJsonPost,
} from "./google-secure-api.mjs";

test("kun regionale EU-endpoints konfigureres", () => {
  const config = readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "eu", GOOGLE_DLP_LOCATION: "eu" });
  assert.equal(config.visionEndpoint, "https://eu-vision.googleapis.com");
  assert.equal(config.dlpEndpoint, "https://dlp.eu.rep.googleapis.com");
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "global" }));
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks\r\nx-evil: true" }));
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("PERSON_NAME"), true);
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("SWIFT_CODE"), true);
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("DFKS_DANISH_CPR_OCR"), true);
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
      if (url.includes("image:redact")) throw new Error("dlp_unavailable");
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(() => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: Buffer.from("jpeg") }]), /dlp_unavailable/);
  assert.equal(visionCalled, false);
});

test("Google DLP returnerer den maskerede side, som alene sendes videre til Vision", async () => {
  const calls = [];
  const raw = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
  const masked = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]);
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "eu",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url, _token, payload) => {
      calls.push({ url, payload });
      if (url.includes("image:redact")) {
        return { redactedImage: masked.toString("base64"), inspectResult: { findings: [{
          infoType: { name: "DENMARK_CPR_NUMBER" },
          location: { contentLocations: [{ imageLocation: { boundingBoxes: [{ top: 2, left: 3, width: 4, height: 5 }] } }] },
        }] } };
      }
      return { responses: [{ fullTextAnnotation: { pages: [] } }] };
    },
  });
  const result = await client.redactAndAnnotate([{ pageNumber: 1, imageBytes: raw }]);
  assert.equal(calls.filter(({ url }) => url.includes("dlp.eu.rep.googleapis.com")).length, 1);
  assert.equal(calls.some(({ url }) => url.includes("image:redact")), true);
  assert.equal("parent" in calls[0].payload, false);
  assert.equal(calls[0].payload.inspectConfig.includeQuote, false);
  assert.equal("limits" in calls[0].payload.inspectConfig, false);
  assert.equal(calls[0].payload.imageRedactionConfigs.some(({ infoType }) => infoType.name === "PERSON_NAME"), true);
  assert.equal(calls[0].payload.imageRedactionConfigs.some(({ infoType }) => infoType.name === "SWIFT_CODE"), true);
  assert.equal(calls[1].payload.requests[0].image.content, masked.toString("base64"));
  assert.equal("parent" in calls[1].payload, false);
  assert.deepEqual(result.redactionCounts, { DENMARK_CPR_NUMBER: 1 });
  assert.deepEqual(result.redactionRegions, [{
    pageNumber: 1, top: 2, left: 3, width: 4, height: 5, infoType: "DENMARK_CPR_NUMBER",
  }]);
  assert.deepEqual(result.redactedPages[0].imageBytes, masked);
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
      if (url.includes("image:redact")) {
        return {
          redactedImage: Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]).toString("base64"),
          inspectResult: { findings: [{ infoType: { name: "IBAN_CODE" }, location: {} }] },
        };
      }
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(() => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: Buffer.from("raw") }]), /dlp_location_missing/);
  assert.equal(visionCalled, false);
});

test("DLP-fund returnerer kun tællinger og geometri, aldrig fundet tekst", () => {
  const result = extractDlpFindings({ inspectResult: { findings: [{
    quote: "hemmeligt-cpr",
    infoType: { name: "DENMARK_CPR_NUMBER" },
    location: { contentLocations: [{ imageLocation: { boundingBoxes: [{ top: 1, left: 2, width: 3, height: 4 }] } }] },
  }] } });
  assert.deepEqual(result, {
    counts: { DENMARK_CPR_NUMBER: 1 },
    boxes: [{ top: 1, left: 2, width: 3, height: 4, infoType: "DENMARK_CPR_NUMBER" }],
  });
  assert.equal(JSON.stringify(result).includes("hemmeligt-cpr"), false);
});

test("DLP-svar uden gyldigt ændret JPEG-billede afvises", () => {
  const source = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
  assert.throws(() => decodeDlpRedactedImage({}, source, 0), /dlp_redacted_image_missing/);
  assert.throws(() => decodeDlpRedactedImage({ redactedImage: Buffer.from("png").toString("base64") }, source, 0), /dlp_redacted_image_invalid/);
  assert.throws(() => decodeDlpRedactedImage({ redactedImage: source.toString("base64") }, source, 1), /dlp_redaction_not_applied/);
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
      if (url.includes("image:redact")) return {
        redactedImage: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]).toString("base64"),
        inspectResult: { findings: [] },
      };
      return { responses: [{ fullTextAnnotation: { pages: [] } }] };
    },
  });
  await client.redactAndAnnotate([{ pageNumber: 1, imageBytes: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]) }]);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [250, 500]);
});
