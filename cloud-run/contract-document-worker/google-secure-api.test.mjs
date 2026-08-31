import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import test from "node:test";
import sharp from "sharp";

import {
  canonicaliseDlpRedactedImage,
  createGoogleOcrClient,
  decodeDlpRedactedImage,
  dlpRequestBodySize,
  extractDlpFindings,
  fetchGoogleAccessToken,
  GOOGLE_OCR_INFO_TYPES,
  GoogleOcrOperationalError,
  isDlpRequestBodyWithinLimit,
  MAX_DLP_IMAGE_BYTES,
  MAX_DLP_REQUEST_BODY_BYTES,
  readGoogleConfig,
  secureJsonPost,
} from "./google-secure-api.mjs";

async function solidJpeg(width = 12, height = 10, background = "#ffffff", quality = 90) {
  return sharp({ create: { width, height, channels: 3, background } })
    .jpeg({ quality })
    .toBuffer();
}

async function rgbAt(imageBytes, x, y) {
  const { data, info } = await sharp(imageBytes).removeAlpha().toColourspace("srgb").raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

test("kun regionale EU-endpoints konfigureres", () => {
  const config = readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "eu", GOOGLE_DLP_LOCATION: "europe" });
  assert.equal(config.visionEndpoint, "https://eu-vision.googleapis.com");
  assert.equal(config.dlpEndpoint, "https://dlp.eu.rep.googleapis.com");
  assert.equal(config.dlpLocation, "europe");
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_DLP_LOCATION: "eu" }));
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "global" }));
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks\r\nx-evil: true" }));
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("PERSON_NAME"), true);
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("SWIFT_CODE"), true);
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("DFKS_DANISH_CPR_OCR"), true);
});

test("metadata-tokenkald efterlader ikke abort-listeners mellem sider", async () => {
  const controller = new AbortController();
  for (let index = 0; index < 20; index += 1) {
    const token = await fetchGoogleAccessToken(async (_url, init) => {
      assert.equal(init.signal.aborted, false);
      return new Response(JSON.stringify({ access_token: "short-lived" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }, { signal: controller.signal });
    assert.equal(token, "short-lived");
  }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("metadata-tokenkald stopper en hængende request ved timeout", async () => {
  await assert.rejects(() => fetchGoogleAccessToken((_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }), { timeoutMs: 10 }), (error) => error instanceof GoogleOcrOperationalError
    && error.code === "google_access_token_failed");
});

test("ugyldig metadata-token-JSON klassificeres som en driftsfejl", async () => {
  await assert.rejects(() => fetchGoogleAccessToken(async () => new Response("ikke-json", {
    status: 200,
  })), (error) => error instanceof GoogleOcrOperationalError
    && error.code === "google_access_token_failed");
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
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
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

test("en ren DLP-JPEG-re-encoding maskeres lokalt og kun en verificeret PNG når Vision", async () => {
  const calls = [];
  const raw = await solidJpeg(12, 10, "#ffffff", 80);
  // This response changes the encoding but deliberately does not redact the
  // finding. A hash-only check would accept and leak it to Vision.
  const merelyReencoded = await sharp(raw).jpeg({ quality: 95 }).toBuffer();
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url, _token, payload) => {
      calls.push({ url, payload });
      if (url.includes("image:redact")) {
        return { redactedImage: merelyReencoded.toString("base64"), inspectResult: { findings: [{
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
  assert.equal(calls[0].url.includes("/locations/europe/image:redact"), true);
  assert.equal("parent" in calls[0].payload, false);
  assert.equal(calls[0].payload.inspectConfig.includeQuote, false);
  assert.equal("limits" in calls[0].payload.inspectConfig, false);
  assert.equal(calls[0].payload.imageRedactionConfigs.some(({ infoType }) => infoType.name === "PERSON_NAME"), true);
  assert.equal(calls[0].payload.imageRedactionConfigs.some(({ infoType }) => infoType.name === "SWIFT_CODE"), true);
  const visionImage = Buffer.from(calls[1].payload.requests[0].image.content, "base64");
  assert.equal(visionImage[0], 0x89);
  assert.equal(visionImage.subarray(1, 4).toString("ascii"), "PNG");
  assert.deepEqual(await rgbAt(visionImage, 3, 2), [0, 0, 0]);
  assert.deepEqual(await rgbAt(visionImage, 6, 6), [0, 0, 0]);
  assert.notDeepEqual(await rgbAt(visionImage, 2, 2), [0, 0, 0]);
  assert.equal("parent" in calls[1].payload, false);
  assert.deepEqual(result.redactionCounts, { DENMARK_CPR_NUMBER: 1 });
  assert.deepEqual(result.redactionRegions, [{
    pageNumber: 1, top: 2, left: 3, width: 4, height: 5, infoType: "DENMARK_CPR_NUMBER",
  }]);
  assert.deepEqual(result.redactedPages[0].imageBytes, visionImage);
});

test("DLP-koordinater uden for siden afvises før Vision", async () => {
  const image = await solidJpeg();
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url) => {
      if (url.includes("image:redact")) return {
        redactedImage: image.toString("base64"),
        inspectResult: { findings: [{
          infoType: { name: "IBAN_CODE" },
          location: { contentLocations: [{ imageLocation: {
            boundingBoxes: [{ top: 2, left: 10, width: 4, height: 3 }],
          } }] },
        }] },
      };
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(
    () => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: image }]),
    /dlp_location_out_of_bounds/,
  );
  assert.equal(visionCalled, false);
});

test("DLP-billede med ændrede dimensioner afvises før Vision", async () => {
  const original = await solidJpeg(12, 10);
  const resized = await solidJpeg(13, 10);
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url) => {
      if (url.includes("image:redact")) return {
        redactedImage: resized.toString("base64"),
        inspectResult: { findings: [] },
      };
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(
    () => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: original }]),
    /dlp_image_dimensions_changed/,
  );
  assert.equal(visionCalled, false);
});

test("kendt DLP-fund uden koordinater stopper før Vision", async () => {
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
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

test("hver DLP-content-location skal have verificerbar geometri", async () => {
  const image = await solidJpeg();
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url) => {
      if (url.includes("image:redact")) return {
        redactedImage: image.toString("base64"),
        inspectResult: { findings: [{
          infoType: { name: "PERSON_NAME" },
          location: { contentLocations: [
            { imageLocation: { boundingBoxes: [{ top: 1, left: 1, width: 2, height: 2 }] } },
            { imageLocation: { boundingBoxes: [] } },
          ] },
        }] },
      };
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(() => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: image }]), /dlp_location_missing/);
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
    unlocatedFindings: 0,
  });
  assert.equal(JSON.stringify(result).includes("hemmeligt-cpr"), false);
});

test("DLP-svar uden et gyldigt dekodbart billede afvises", async () => {
  const source = await solidJpeg();
  assert.throws(() => decodeDlpRedactedImage({}), /dlp_redacted_image_missing/);
  await assert.rejects(
    () => canonicaliseDlpRedactedImage(
      { redactedImage: Buffer.from("not-an-image").toString("base64") },
      source,
      [],
    ),
    /dlp_redacted_image_invalid/,
  );
});

test("DLP måler hele base64-JSON-requesten og stopper før netværket over sikkerhedsgrænsen", async () => {
  const small = Buffer.alloc(2_000_000, 0xff);
  const large = Buffer.alloc(3_000_000, 0xff);
  assert.equal(dlpRequestBodySize(small) < MAX_DLP_REQUEST_BODY_BYTES, true);
  assert.equal(isDlpRequestBodyWithinLimit(small), true);
  assert.equal(dlpRequestBodySize(large) > MAX_DLP_REQUEST_BODY_BYTES, true);
  assert.equal(isDlpRequestBodyWithinLimit(large), false);
  assert.equal(large.length > MAX_DLP_IMAGE_BYTES, true);

  let tokenCalled = false;
  let networkCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => { tokenCalled = true; return "short-lived"; },
    jsonPost: async () => { networkCalled = true; return {}; },
  });
  await assert.rejects(() => client.inspectAndRedact(large), /dlp_request_too_large/);
  assert.equal(tokenCalled, false);
  assert.equal(networkCalled, false);
});

test("DLP-redigerede flersidede rasterbuffere har et samlet RAM-budget før Vision", async () => {
  let dlpCalls = 0;
  let visionCalled = false;
  const raw = await solidJpeg(100, 100);
  const redacted = await sharp(raw).jpeg({ quality: 85 }).toBuffer();
  const canonical = await canonicaliseDlpRedactedImage(
    { redactedImage: redacted.toString("base64") },
    raw,
    [],
  );
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url) => {
      if (url.includes("image:redact")) {
        dlpCalls += 1;
        return { redactedImage: redacted.toString("base64"), inspectResult: { findings: [] } };
      }
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(() => client.redactAndAnnotate([
    { pageNumber: 1, imageBytes: raw },
    { pageNumber: 2, imageBytes: raw },
  ], {
    resourceLimits: {
      maxDocumentPages: 2,
      maxDocumentRasterBytes: raw.length * 2,
      maxDocumentTotalRasterBytes: (raw.length * 2) + (canonical.imageBytes.length * 2) - 1,
    },
  }), /document_raster_budget_exceeded/);
  assert.equal(dlpCalls, 2);
  assert.equal(visionCalled, false);
});

test("for stort Vision-svar afvises med sikker dokumentkode", async () => {
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async () => ({ responses: [{ fullTextAnnotation: { text: "x".repeat(256) } }] }),
  });
  await assert.rejects(
    () => client.annotateBatch([{ imageBytes: Buffer.from("image") }], {
      resourceLimits: { maxVisionResponseBytesPerBatch: 128 },
    }),
    (error) => error instanceof GoogleOcrOperationalError
      && error.code === "vision_response_too_large",
  );
});

test("Vision-svar har et samlet dokumentbudget på tværs af batches", async () => {
  const image = await solidJpeg();
  const responseFor = (count) => Array.from({ length: count }, () => ({
    fullTextAnnotation: { text: "x".repeat(20) },
  }));
  const firstBatchBytes = Buffer.byteLength(JSON.stringify(responseFor(16)));
  const secondBatchBytes = Buffer.byteLength(JSON.stringify(responseFor(1)));
  let visionCalls = 0;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url, _token, payload) => {
      if (url.includes("image:redact")) {
        return { redactedImage: image.toString("base64"), inspectResult: { findings: [] } };
      }
      visionCalls += 1;
      return { responses: responseFor(payload.requests.length) };
    },
  });
  await assert.rejects(
    () => client.redactAndAnnotate(
      Array.from({ length: 17 }, (_, index) => ({ pageNumber: index + 1, imageBytes: image })),
      { resourceLimits: {
        maxDocumentPages: 17,
        maxVisionResponseBytesPerBatch: firstBatchBytes + 1,
        maxVisionResponseBytesTotal: firstBatchBytes + secondBatchBytes - 1,
      } },
    ),
    (error) => error instanceof GoogleOcrOperationalError
      && error.code === "vision_response_too_large",
  );
  assert.equal(visionCalls, 2);
});

test("Vision HTTP-body stoppes under streaming før JSON-parsing", async () => {
  const requestImpl = (_options, callback) => {
    const request = new EventEmitter();
    const socket = new EventEmitter();
    socket.getProtocol = () => "TLSv1.3";
    request.end = () => {
      request.emit("socket", socket);
      socket.emit("secureConnect");
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit("data", Buffer.alloc((16 * 1024 * 1024) + 1));
      response.emit("end");
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
  await assert.rejects(
    () => secureJsonPost(
      "https://eu-vision.googleapis.com/v1/projects/dfks/locations/eu/images:annotate",
      "short-lived",
      {},
      { requestImpl },
    ),
    (error) => error instanceof GoogleOcrOperationalError
      && error.code === "vision_response_too_large",
  );
});

test("Google HTTP-fejl klassificeres uden svartekst efter DLP eller Vision", async () => {
  const requestImpl = (options, callback) => {
    const request = new EventEmitter();
    const socket = new EventEmitter();
    socket.getProtocol = () => "TLSv1.3";
    request.end = () => {
      request.emit("socket", socket);
      socket.emit("secureConnect");
      const response = new EventEmitter();
      response.statusCode = options.hostname === "dlp.eu.rep.googleapis.com" ? 400 : 503;
      callback(response);
      response.emit("data", Buffer.from("sensitive provider response must not escape"));
      response.emit("end");
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
  await assert.rejects(
    () => secureJsonPost("https://dlp.eu.rep.googleapis.com/v2/projects/dfks/locations/europe/image:redact", "token", {}, { requestImpl }),
    (error) => error instanceof GoogleOcrOperationalError && error.code === "dlp_api_400",
  );
  await assert.rejects(
    () => secureJsonPost("https://eu-vision.googleapis.com/v1/projects/dfks/locations/eu/images:annotate", "token", {}, { requestImpl }),
    (error) => error instanceof GoogleOcrOperationalError && error.code === "vision_api_503",
  );
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
  const image = await solidJpeg();
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    retryDelay: async (milliseconds) => delays.push(milliseconds),
    jsonPost: async (url) => {
      attempts += 1;
      if (attempts < 3) throw new GoogleOcrOperationalError("dlp_api_503");
      if (url.includes("image:redact")) return {
        redactedImage: image.toString("base64"),
        inspectResult: { findings: [] },
      };
      return { responses: [{ fullTextAnnotation: { pages: [] } }] };
    },
  });
  await client.redactAndAnnotate([{ pageNumber: 1, imageBytes: image }]);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [250, 500]);
});

test("abort af et igangværende DLP-kald stopper retries og Vision fail-closed", async () => {
  const controller = new AbortController();
  const reason = new Error("processing_deadline_exceeded");
  let dlpAttempts = 0;
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async ({ signal }) => {
      assert.equal(signal, controller.signal);
      return "short-lived";
    },
    jsonPost: async (url, _token, _payload, { signal }) => {
      if (!url.includes("image:redact")) {
        visionCalled = true;
        return { responses: [] };
      }
      dlpAttempts += 1;
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  const processing = client.redactAndAnnotate([{
    pageNumber: 1,
    imageBytes: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
  }], { signal: controller.signal });
  setTimeout(() => controller.abort(reason), 10);

  await assert.rejects(processing, (error) => error === reason);
  assert.equal(dlpAttempts, 1);
  assert.equal(visionCalled, false);
});

test("abort af retry-pausen forhindrer et nyt Google-kald", async () => {
  const controller = new AbortController();
  const reason = new Error("processing_deadline_exceeded");
  let attempts = 0;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "europe",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async () => {
      attempts += 1;
      throw new GoogleOcrOperationalError("dlp_api_503");
    },
  });
  const startedAt = Date.now();
  const processing = client.inspectAndRedact(
    Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(reason), 10);

  await assert.rejects(processing, (error) => error === reason);
  assert.equal(attempts, 1);
  assert.equal(Date.now() - startedAt < 200, true);
});

test("abort lukker det underliggende regionale HTTPS-kald", async () => {
  const controller = new AbortController();
  const reason = new Error("processing_deadline_exceeded");
  let destroyedWith;
  const requestImpl = () => {
    const request = new EventEmitter();
    request.end = () => {};
    request.destroy = (error) => {
      destroyedWith = error;
      request.emit("error", error);
    };
    return request;
  };
  const pending = secureJsonPost(
    "https://dlp.eu.rep.googleapis.com/v2/projects/dfks/locations/europe/image:redact",
    "short-lived",
    {},
    { requestImpl, signal: controller.signal },
  );
  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(destroyedWith, reason);
});
