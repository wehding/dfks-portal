import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import sharp from "sharp";

import {
  createGoogleOcrClient,
  createOrientationPageVisionVariants,
  createUnreadablePageVisionVariants,
  GoogleOcrOperationalError,
  prepareImageForVision,
  readGoogleConfig,
  secureJsonPost,
  visionRequestBodySize,
} from "./google-vision-api.mjs";

async function jpeg(width = 120, height = 80, noise = false) {
  let seed = 0x12345678;
  const pixels = noise ? Buffer.allocUnsafe(width * height * 3) : null;
  if (pixels) {
    for (let index = 0; index < pixels.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[index] = seed & 0xff;
    }
  }
  return sharp(
    pixels ?? { create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } },
    pixels ? { raw: { width, height, channels: 3 } } : undefined,
  )
    .jpeg({ quality: 95 })
    .toBuffer();
}

test("konfiguration tillader kun Google Vision EU", () => {
  const config = readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod", GOOGLE_VISION_LOCATION: "eu" });
  assert.equal(config.visionEndpoint, "https://eu-vision.googleapis.com");
  assert.equal("dlpEndpoint" in config, false);
  assert.throws(
    () => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod", GOOGLE_VISION_LOCATION: "us" }),
    /invalid_google_ocr_configuration/,
  );
});

test("Vision payload bruger dokument-OCR og indeholder ingen DLP-konfiguration", async () => {
  const page = await jpeg();
  const calls = [];
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod", GOOGLE_VISION_LOCATION: "eu" }),
    accessTokenProvider: async () => "token",
    jsonPost: async (url, token, payload) => {
      calls.push({ url, token, payload });
      return { responses: payload.requests.map(() => ({ fullTextAnnotation: { pages: [] } })) };
    },
  });
  const result = await client.annotateDocument([{ pageNumber: 1, imageBytes: page }]);
  assert.equal(result.responses.length, 1);
  assert.equal(result.sourcePages[0].imageBytes.equals(page), true);
  assert.match(calls[0].url, /^https:\/\/eu-vision\.googleapis\.com\/v1\/projects\/dfks-prod\/locations\/eu\/images:annotate/);
  assert.equal(calls[0].payload.requests[0].features[0].type, "DOCUMENT_TEXT_DETECTION");
  assert.equal(JSON.stringify(calls[0]).toLowerCase().includes("dlp"), false);
});

test("Vision-batches er højst 16 sider", async () => {
  const page = await jpeg();
  const batchSizes = [];
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async (url, token, payload) => {
      batchSizes.push(payload.requests.length);
      return { responses: payload.requests.map(() => ({})) };
    },
  });
  await client.annotateDocument(Array.from({ length: 17 }, (_, index) => ({
    pageNumber: index + 1,
    imageBytes: page,
  })));
  assert.deepEqual(batchSizes, [16, 1]);
});

test("stor transportkopi nedskaleres uden at ændre kildesiden", async () => {
  const page = await jpeg(2400, 2400, true);
  const prepared = await prepareImageForVision(page, { maxRequestBodyBytes: 5_000_000 });
  assert.equal(prepared.downscaled, true);
  assert.equal(prepared.imageBytes.equals(page), false);
  assert.equal(prepared.visionWidth < prepared.sourceWidth, true);
  assert.equal(visionRequestBodySize([{ imageBytes: prepared.imageBytes }]) <= 5_000_000, true);
});

test("for stor Vision-respons splittes deterministisk", async () => {
  const page = await jpeg();
  const batches = [];
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async (url, token, payload) => {
      batches.push(payload.requests.length);
      if (payload.requests.length > 1) throw new GoogleOcrOperationalError("vision_response_too_large");
      return { responses: [{}] };
    },
  });
  const result = await client.annotateDocument([1, 2, 3, 4].map((pageNumber) => ({ pageNumber, imageBytes: page })));
  assert.equal(result.responses.length, 4);
  assert.deepEqual(batches, [4, 2, 1, 1, 2, 1, 1]);
});

test("for stor enkeltsiderespons genprøves én gang med en mindre transportkopi", async () => {
  const page = await jpeg(1200, 800, true);
  let calls = 0;
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async () => {
      calls += 1;
      return calls === 1
        ? { responses: [{ fullTextAnnotation: { text: "x".repeat(2_000) } }] }
        : { responses: [{}] };
    },
  });
  const result = await client.annotateDocument(
    [{ pageNumber: 1, imageBytes: page }],
    { resourceLimits: { maxVisionResponseBytesPerBatch: 1_000 } },
  );
  assert.equal(calls, 2);
  assert.equal(result.sourcePages[0].imageBytes.equals(page), true);
  assert.equal(result.visionPageTransforms[0].visionWidth < 1200, true);
});

test("ulæselig side får præcis to deterministiske farve- og kontrastvarianter", async () => {
  const page = await jpeg(180, 120, true);
  const first = await createUnreadablePageVisionVariants(page);
  const second = await createUnreadablePageVisionVariants(page);
  assert.deepEqual(first.map((variant) => variant.kind), ["colour", "contrast_gray"]);
  assert.equal(first.length, 2);
  assert.equal(first[0].width, 180);
  assert.equal(first[0].height, 120);
  assert.equal(first[0].imageBytes.equals(second[0].imageBytes), true);
  assert.equal(first[1].imageBytes.equals(second[1].imageBytes), true);
  assert.equal(first[0].imageBytes.equals(first[1].imageBytes), false);
});

test("ulæselig-side retry kalder Vision højst én gang med de to varianter", async () => {
  const page = await jpeg(180, 120, true);
  const calls = [];
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async (url, token, payload) => {
      calls.push(payload.requests.length);
      return { responses: payload.requests.map(() => ({ fullTextAnnotation: { pages: [] } })) };
    },
  });
  const result = await client.annotateUnreadablePageVariants({
    pageNumber: 4,
    imageBytes: page,
  });
  assert.deepEqual(calls, [2]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["colour", "contrast_gray"]);
  assert.equal(result.variants.every((variant) => variant.transform.pageNumber === 4), true);
  assert.equal(result.retainedRasterBytes > 0, true);
  assert.equal(result.retainedVisionResponseBytes > 0, true);
});

test("ulæselig-side retry splitter og nedskalerer adaptivt ved for stor Vision-respons", async () => {
  const page = await jpeg(1200, 800, true);
  const calls = [];
  let callNumber = 0;
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async (url, token, payload) => {
      callNumber += 1;
      calls.push(payload.requests.length);
      const large = callNumber <= 2;
      return {
        responses: payload.requests.map(() => large
          ? { fullTextAnnotation: { text: "x".repeat(2_000) } }
          : {}),
      };
    },
  });
  const result = await client.annotateUnreadablePageVariants({
    pageNumber: 1,
    imageBytes: page,
  }, {
    resourceLimits: { maxVisionResponseBytesPerBatch: 1_000 },
    maxAdditionalResponseBytes: 10_000,
  });
  assert.deepEqual(calls, [2, 1, 1, 1]);
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].transform.visionWidth < 1200, true);
  assert.equal(result.variants[0].transform.recoveryAttempts, 1);
  assert.equal(result.variants[1].transform.recoveryAttempts, 0);
});

test("ulæselig-side retry respekterer dokumentets resterende rasterbudget", async () => {
  const page = await jpeg(180, 120, true);
  let calls = 0;
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async () => {
      calls += 1;
      return { responses: [{}, {}] };
    },
  });
  await assert.rejects(() => client.annotateUnreadablePageVariants({
    pageNumber: 1,
    imageBytes: page,
  }, { maxAdditionalRasterBytes: 1 }), /document_raster_budget_exceeded/);
  assert.equal(calls, 0);
});

test("orienteringsretry opretter præcis fire deterministiske kardinalvarianter", async () => {
  const page = await jpeg(180, 120, true);
  const first = await createOrientationPageVisionVariants(page);
  const second = await createOrientationPageVisionVariants(page);
  assert.deepEqual(first.map((variant) => variant.rotationDegrees), [0, 90, 180, 270]);
  assert.deepEqual(first.map((variant) => variant.kind), [
    "rotate_0", "rotate_90", "rotate_180", "rotate_270",
  ]);
  assert.equal(first.every((variant) => (
    variant.canonicalWidth === 180 && variant.canonicalHeight === 120
  )), true);
  assert.equal(first[0].imageBytes.equals(second[0].imageBytes), true);
  assert.equal(first[1].imageBytes.equals(second[1].imageBytes), true);
  const dimensions = await Promise.all(first.map((variant) => sharp(variant.imageBytes).metadata()));
  assert.deepEqual(dimensions.map(({ width, height }) => [width, height]), [
    [180, 120], [120, 180], [180, 120], [120, 180],
  ]);
});

test("orienteringsretry bruger én afgrænset Vision-batch og bevarer canonical transform", async () => {
  const page = await jpeg(180, 120, true);
  const calls = [];
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async (url, token, payload) => {
      calls.push(payload.requests.length);
      return { responses: payload.requests.map(() => ({ fullTextAnnotation: { pages: [] } })) };
    },
  });
  const result = await client.annotateOrientationPageVariants({
    pageNumber: 7,
    imageBytes: page,
  });
  assert.deepEqual(calls, [4]);
  assert.deepEqual(result.variants.map((variant) => variant.transform.rotationDegrees), [
    0, 90, 180, 270,
  ]);
  assert.equal(result.variants.every((variant) => (
    variant.transform.pageNumber === 7
      && variant.transform.canonicalWidth === 180
      && variant.transform.canonicalHeight === 120
  )), true);
});

test("orienteringsretry respekterer abort-, raster- og responsgrænser", async () => {
  const page = await jpeg(180, 120, true);
  let calls = 0;
  const client = createGoogleOcrClient({
    config: readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks-prod" }),
    accessTokenProvider: async () => "token",
    jsonPost: async (url, token, payload) => {
      calls += 1;
      return { responses: payload.requests.map(() => ({})) };
    },
  });
  await assert.rejects(() => client.annotateOrientationPageVariants({
    pageNumber: 1, imageBytes: page,
  }, { maxAdditionalRasterBytes: 1 }), /document_raster_budget_exceeded/);
  assert.equal(calls, 0);

  await assert.rejects(() => client.annotateOrientationPageVariants({
    pageNumber: 1, imageBytes: page,
  }, { maxAdditionalResponseBytes: 1 }), /vision_response_too_large/);
  assert.equal(calls, 1);

  const controller = new AbortController();
  controller.abort(new Error("lease_lost"));
  await assert.rejects(() => client.annotateOrientationPageVariants({
    pageNumber: 1, imageBytes: page,
  }, { signal: controller.signal }), /lease_lost/);
  assert.equal(calls, 1);
});

test("transport afviser alle andre Google-hosts", async () => {
  await assert.rejects(
    () => secureJsonPost("https://vision.googleapis.com/v1/images:annotate", "token", {}),
    /google_endpoint_rejected/,
  );
});

test("transport kræver TLS 1.3", async () => {
  const requestImpl = () => {
    const request = new EventEmitter();
    request.end = () => {
      const socket = new EventEmitter();
      socket.getProtocol = () => "TLSv1.2";
      request.emit("socket", socket);
      socket.emit("secureConnect");
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
  await assert.rejects(
    () => secureJsonPost(
      "https://eu-vision.googleapis.com/v1/projects/dfks-prod/locations/eu/images:annotate",
      "token", { requests: [] }, { requestImpl },
    ),
    /google_tls_version_rejected/,
  );
});
