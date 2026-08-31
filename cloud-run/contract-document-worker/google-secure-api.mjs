import https from "node:https";
import sharp from "sharp";

import {
  MAX_VISION_RESPONSE_BYTES_PER_BATCH,
  resolveDocumentResourceLimits,
} from "./resource-limits.mjs";

const VISION_HOST = "eu-vision.googleapis.com";
const DLP_HOST = "dlp.eu.rep.googleapis.com";
const MAX_VISION_IMAGES = 16;
const MAX_VISION_BODY_BYTES = 8 * 1024 * 1024;
// Google documents a 4 MB limit for image:redact requests. Keep a small
// margin for service-side framing changes and measure the complete JSON body,
// not only the JPEG before base64 expansion.
export const MAX_DLP_REQUEST_BODY_BYTES = 3_900_000;
// Base64 adds roughly one third. Reject oversized images before constructing
// the base64 payload so a hostile or pathological page cannot create multiple
// large in-memory copies merely to discover that Google will reject it.
export const MAX_DLP_IMAGE_BYTES = 2_900_000;
const MAX_DLP_BOXES_PER_PAGE = 2_000;
const MAX_DLP_DECODED_PIXELS = 64_000_000;
const MAX_DLP_REDACTED_IMAGE_BYTES = 16 * 1024 * 1024;
const DLP_INFO_TYPES = [
  "DENMARK_CPR_NUMBER",
  "PERSON_NAME",
  "FINANCIAL_ACCOUNT_NUMBER",
  "IBAN_CODE",
  "SWIFT_CODE",
  "CREDIT_CARD_NUMBER",
  "CREDIT_CARD_TRACK_NUMBER",
  "CVV_NUMBER",
];
const DLP_CUSTOM_INFO_TYPES = [
  {
    infoType: { name: "DFKS_DANISH_CPR_OCR" },
    likelihood: "POSSIBLE",
    regex: {
      pattern: "(?:0[1-9]|[12][0-9]|3[01])[ .-]?(?:0[1-9]|1[0-2])[ .-]?[0-9]{2}[ -]?[0-9]{4}",
    },
  },
  {
    infoType: { name: "DFKS_DANISH_BANK_ACCOUNT" },
    likelihood: "POSSIBLE",
    regex: {
      pattern: "(?i)(?:reg(?:istrerings)?[ .]*(?:nr[.]?)?|konto(?:nummer)?|bankkonto)[ :#.-]*[0-9]{4}(?:[ -]+)[0-9][0-9 -]{5,13}[0-9]",
    },
  },
];
const DLP_REDACTION_INFO_TYPES = [
  ...DLP_INFO_TYPES,
  ...DLP_CUSTOM_INFO_TYPES.map((entry) => entry.infoType.name),
];

export class GoogleOcrOperationalError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "GoogleOcrOperationalError";
    this.code = code;
  }
}

export function readGoogleConfig(env = process.env) {
  const projectId = env.GOOGLE_CLOUD_PROJECT?.trim();
  const visionLocation = env.GOOGLE_VISION_LOCATION?.trim() || "eu";
  // Sensitive Data Protection names the EU multi-region `europe` in resource
  // paths, while its regional endpoint is `dlp.eu.rep.googleapis.com`.
  const dlpLocation = env.GOOGLE_DLP_LOCATION?.trim() || "europe";
  if (!projectId || !/^[a-z][a-z0-9-]{3,62}$/.test(projectId)
    || visionLocation !== "eu" || dlpLocation !== "europe") {
    throw new GoogleOcrOperationalError("invalid_google_ocr_configuration");
  }
  return {
    projectId,
    visionLocation,
    dlpLocation,
    visionEndpoint: `https://${VISION_HOST}`,
    dlpEndpoint: `https://${DLP_HOST}`,
  };
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new GoogleOcrOperationalError("google_request_failed");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function waitForRetry(milliseconds, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchGoogleAccessToken(fetchImpl = fetch, { signal } = {}) {
  let response;
  try {
    response = await fetchImpl(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    throw new GoogleOcrOperationalError("google_access_token_failed", { cause: error });
  }
  if (!response.ok) throw new GoogleOcrOperationalError("google_access_token_failed");
  const body = await response.json();
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new GoogleOcrOperationalError("google_access_token_failed");
  }
  return body.access_token;
}

export async function secureJsonPost(urlValue, token, payload, {
  requestImpl = https.request,
  quotaProject,
  signal,
} = {}) {
  throwIfAborted(signal);
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || ![VISION_HOST, DLP_HOST].includes(url.hostname)) {
    throw new GoogleOcrOperationalError("google_endpoint_rejected");
  }
  const apiStage = url.hostname === DLP_HOST ? "dlp" : "vision";
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const request = requestImpl({
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      minVersion: "TLSv1.3",
      rejectUnauthorized: true,
      timeout: 60_000,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": body.length,
        ...(quotaProject ? { "x-goog-user-project": quotaProject } : {}),
      },
    }, (response) => {
      const chunks = [];
      let total = 0;
      const responseByteLimit = apiStage === "vision"
        ? MAX_VISION_RESPONSE_BYTES_PER_BATCH
        : 50 * 1024 * 1024;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > responseByteLimit) {
          request.destroy(new GoogleOcrOperationalError(`${apiStage}_response_too_large`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          finish(reject, new GoogleOcrOperationalError(`${apiStage}_api_${response.statusCode || "failed"}`));
          return;
        }
        try {
          finish(resolve, text ? JSON.parse(text) : {});
        } catch {
          finish(reject, new GoogleOcrOperationalError("google_response_invalid"));
        }
      });
    });
    const onAbort = () => request.destroy(abortReason(signal));
    request.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        if (socket.getProtocol?.() !== "TLSv1.3") {
            request.destroy(new GoogleOcrOperationalError("google_tls_version_rejected"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new GoogleOcrOperationalError("google_request_timeout")));
    request.on("error", (error) => finish(reject, signal?.aborted
      ? abortReason(signal)
      : error instanceof GoogleOcrOperationalError
        ? error : new GoogleOcrOperationalError("google_request_failed", { cause: error })));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    request.end(body);
  });
}

export function extractDlpFindings(response) {
  const counts = {};
  const boxes = [];
  let unlocatedFindings = 0;
  const findings = response?.inspectResult?.findings ?? response?.result?.findings ?? [];
  for (const finding of findings) {
    const name = finding?.infoType?.name;
    if (!DLP_REDACTION_INFO_TYPES.includes(name)) continue;
    counts[name] = (counts[name] ?? 0) + 1;
    let findingHasLocation = false;
    for (const location of finding?.location?.contentLocations ?? []) {
      for (const box of location?.imageLocation?.boundingBoxes ?? []) {
        const parsed = {
          top: Number(box?.top),
          left: Number(box?.left),
          width: Number(box?.width),
          height: Number(box?.height),
        };
        if (Object.values(parsed).every(Number.isFinite)
          && parsed.top >= 0 && parsed.left >= 0 && parsed.width > 0 && parsed.height > 0) {
          boxes.push({ ...parsed, infoType: name });
          findingHasLocation = true;
        } else {
          throw new GoogleOcrOperationalError("dlp_location_invalid");
        }
      }
    }
    if (!findingHasLocation) unlocatedFindings += 1;
  }
  if (boxes.length > MAX_DLP_BOXES_PER_PAGE) {
    throw new GoogleOcrOperationalError("dlp_too_many_locations");
  }
  return { counts, boxes, unlocatedFindings };
}

export function buildDlpRedactPayload(imageBytes) {
  return {
    inspectConfig: {
      infoTypes: DLP_INFO_TYPES.map((name) => ({ name })),
      customInfoTypes: DLP_CUSTOM_INFO_TYPES,
      minLikelihood: "POSSIBLE",
      includeQuote: false,
    },
    imageRedactionConfigs: DLP_REDACTION_INFO_TYPES.map((name) => ({ infoType: { name } })),
    includeFindings: true,
    byteItem: { type: "IMAGE_JPEG", data: imageBytes.toString("base64") },
  };
}

export function dlpRequestBodySize(imageBytes) {
  return Buffer.byteLength(JSON.stringify(buildDlpRedactPayload(imageBytes)));
}

export function isDlpRequestBodyWithinLimit(imageBytes) {
  if (imageBytes.length > MAX_DLP_IMAGE_BYTES) return false;
  return dlpRequestBodySize(imageBytes) <= MAX_DLP_REQUEST_BODY_BYTES;
}

export function decodeDlpRedactedImage(response) {
  if (typeof response?.redactedImage !== "string" || !response.redactedImage) {
    throw new GoogleOcrOperationalError("dlp_redacted_image_missing");
  }
  const image = Buffer.from(response.redactedImage, "base64");
  if (!image.length || image.length > MAX_DLP_REDACTED_IMAGE_BYTES) {
    throw new GoogleOcrOperationalError("dlp_redacted_image_invalid");
  }
  return image;
}

function imageReader(imageBytes) {
  return sharp(imageBytes, {
    failOn: "warning",
    limitInputPixels: MAX_DLP_DECODED_PIXELS,
    sequentialRead: true,
  });
}

async function readImageMetadata(imageBytes) {
  try {
    const metadata = await imageReader(imageBytes).metadata();
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || metadata.width <= 0 || metadata.height <= 0
      || metadata.width * metadata.height > MAX_DLP_DECODED_PIXELS) {
      throw new Error("invalid_dimensions");
    }
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error instanceof GoogleOcrOperationalError) throw error;
    throw new GoogleOcrOperationalError("dlp_redacted_image_invalid", { cause: error });
  }
}

function normaliseAndValidateBoxes(boxes, width, height) {
  return boxes.map((box) => {
    const left = Math.floor(box.left);
    const top = Math.floor(box.top);
    const right = Math.ceil(box.left + box.width);
    const bottom = Math.ceil(box.top + box.height);
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(top)
      || !Number.isSafeInteger(right) || !Number.isSafeInteger(bottom)
      || left < 0 || top < 0 || right <= left || bottom <= top
      || right > width || bottom > height) {
      throw new GoogleOcrOperationalError("dlp_location_out_of_bounds");
    }
    return {
      ...box,
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  });
}

function overwriteAndVerifyBlackPixels(data, channels, width, boxes) {
  for (const box of boxes) {
    for (let y = box.top; y < box.top + box.height; y += 1) {
      for (let x = box.left; x < box.left + box.width; x += 1) {
        const offset = (y * width + x) * channels;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }
  for (const box of boxes) {
    for (let y = box.top; y < box.top + box.height; y += 1) {
      for (let x = box.left; x < box.left + box.width; x += 1) {
        const offset = (y * width + x) * channels;
        if (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0) {
          throw new GoogleOcrOperationalError("dlp_redaction_not_applied");
        }
      }
    }
  }
}

export async function canonicaliseDlpRedactedImage(response, originalImage, boxes) {
  const redactedImage = decodeDlpRedactedImage(response);
  const [originalMetadata, redactedMetadata] = await Promise.all([
    readImageMetadata(originalImage),
    readImageMetadata(redactedImage),
  ]);
  if (originalMetadata.width !== redactedMetadata.width
    || originalMetadata.height !== redactedMetadata.height) {
    throw new GoogleOcrOperationalError("dlp_image_dimensions_changed");
  }
  const safeBoxes = normaliseAndValidateBoxes(
    boxes,
    originalMetadata.width,
    originalMetadata.height,
  );
  let raw;
  try {
    raw = await imageReader(redactedImage)
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new GoogleOcrOperationalError("dlp_redacted_image_invalid", { cause: error });
  }
  if (raw.info.width !== originalMetadata.width || raw.info.height !== originalMetadata.height
    || raw.info.channels < 3) {
    throw new GoogleOcrOperationalError("dlp_image_dimensions_changed");
  }
  overwriteAndVerifyBlackPixels(raw.data, raw.info.channels, raw.info.width, safeBoxes);
  let canonicalPng;
  try {
    canonicalPng = await sharp(raw.data, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      },
    }).png({ compressionLevel: 9, palette: false }).toBuffer();
  } catch (error) {
    throw new GoogleOcrOperationalError("dlp_redacted_image_invalid", { cause: error });
  }
  if (!canonicalPng.length || canonicalPng.length > MAX_DLP_REDACTED_IMAGE_BYTES
    || canonicalPng[0] !== 0x89 || canonicalPng.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new GoogleOcrOperationalError("dlp_canonical_image_invalid");
  }
  return { imageBytes: canonicalPng, boxes: safeBoxes };
}

export function createGoogleOcrClient({
  config = readGoogleConfig(),
  accessTokenProvider = ({ signal } = {}) => fetchGoogleAccessToken(fetch, { signal }),
  jsonPost = secureJsonPost,
  retryDelay = waitForRetry,
} = {}) {
  async function post(url, token, payload, { signal } = {}) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await jsonPost(url, token, payload, { quotaProject: config.projectId, signal });
      } catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        lastError = error;
        const retryable = error instanceof GoogleOcrOperationalError
          && (/^(?:google|dlp|vision)_api_(?:429|500|502|503|504)$/.test(error.code)
            || ["google_request_timeout", "google_request_failed"].includes(error.code));
        if (!retryable || attempt === 2) throw error;
        await retryDelay(250 * (attempt + 1), { signal });
        throwIfAborted(signal);
      }
    }
    throw lastError;
  }

  async function inspectAndRedact(imageBytes, { signal } = {}) {
    throwIfAborted(signal);
    if (!isDlpRequestBodyWithinLimit(imageBytes)) {
      throw new GoogleOcrOperationalError("dlp_request_too_large");
    }
    const payload = buildDlpRedactPayload(imageBytes);
    const token = await accessTokenProvider({ signal });
    throwIfAborted(signal);
    const parent = `projects/${config.projectId}/locations/${config.dlpLocation}`;
    const redacted = await post(
      `${config.dlpEndpoint}/v2/${parent}/image:redact`,
      token,
      payload,
      { signal },
    );
    const { counts, boxes, unlocatedFindings } = extractDlpFindings(redacted);
    if (unlocatedFindings > 0) {
      // Fail closed rather than sending a known sensitive page to Vision without
      // auditable redaction geometry.
      throw new GoogleOcrOperationalError("dlp_location_missing");
    }
    const canonical = await canonicaliseDlpRedactedImage(redacted, imageBytes, boxes);
    return {
      imageBytes: canonical.imageBytes,
      counts,
      boxes: canonical.boxes,
    };
  }

  function visionResponseByteSize(value) {
    try {
      return Buffer.byteLength(JSON.stringify(value));
    } catch (error) {
      throw new GoogleOcrOperationalError("vision_response_invalid", { cause: error });
    }
  }

  async function annotateBatch(pages, { signal, resourceLimits } = {}) {
    throwIfAborted(signal);
    const token = await accessTokenProvider({ signal });
    throwIfAborted(signal);
    const parent = `projects/${config.projectId}/locations/${config.visionLocation}`;
    const payload = {
      requests: pages.map((page) => ({
        image: { content: page.imageBytes.toString("base64") },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["da", "en"] },
      })),
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_VISION_BODY_BYTES) {
      throw new GoogleOcrOperationalError("vision_request_too_large");
    }
    const result = await post(
      `${config.visionEndpoint}/v1/${parent}/images:annotate`,
      token,
      payload,
      { signal },
    );
    if (!Array.isArray(result.responses) || result.responses.length !== pages.length) {
      throw new GoogleOcrOperationalError("vision_response_invalid");
    }
    const limits = resolveDocumentResourceLimits(resourceLimits);
    if (visionResponseByteSize(result.responses) > limits.maxVisionResponseBytesPerBatch) {
      throw new GoogleOcrOperationalError("vision_response_too_large");
    }
    return result.responses;
  }

  async function redactAndAnnotate(pages, {
    assertHealthy = () => {},
    resourceLimits,
    signal,
  } = {}) {
    const checkHealthy = () => {
      throwIfAborted(signal);
      assertHealthy();
      throwIfAborted(signal);
    };
    checkHealthy();
    const limits = resolveDocumentResourceLimits(resourceLimits);
    if (pages.length > limits.maxDocumentPages) {
      throw new GoogleOcrOperationalError("document_page_limit_exceeded");
    }
    let retainedRasterBytes = 0;
    for (const page of pages) {
      retainedRasterBytes += page?.imageBytes?.length ?? 0;
      if (retainedRasterBytes > limits.maxDocumentRasterBytes
        || retainedRasterBytes > limits.maxDocumentTotalRasterBytes) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
      }
    }
    const redactedPages = [];
    const totalCounts = {};
    const redactionRegions = [];
    for (const page of pages) {
      checkHealthy();
      // Fail closed: a DLP error prevents the page from reaching Vision.
      const redacted = await inspectAndRedact(page.imageBytes, { signal });
      checkHealthy();
      retainedRasterBytes += redacted.imageBytes.length;
      if (retainedRasterBytes > limits.maxDocumentTotalRasterBytes) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
      }
      for (const [name, count] of Object.entries(redacted.counts)) {
        totalCounts[name] = (totalCounts[name] ?? 0) + count;
      }
      redactionRegions.push(...redacted.boxes.map((box) => ({ pageNumber: page.pageNumber, ...box })));
      redactedPages.push({ ...page, imageBytes: redacted.imageBytes });
    }

    const responses = [];
    let retainedVisionResponseBytes = 0;
    const appendResponses = (batchResponses) => {
      retainedVisionResponseBytes += visionResponseByteSize(batchResponses);
      if (retainedVisionResponseBytes > limits.maxVisionResponseBytesTotal) {
        throw new GoogleOcrOperationalError("vision_response_too_large");
      }
      responses.push(...batchResponses);
    };
    let batch = [];
    let estimatedBytes = 0;
    for (const page of redactedPages) {
      const pageBytes = Math.ceil(page.imageBytes.length * 4 / 3) + 1024;
      if (batch.length && (batch.length >= MAX_VISION_IMAGES || estimatedBytes + pageBytes > MAX_VISION_BODY_BYTES - 128_000)) {
        checkHealthy();
        appendResponses(await annotateBatch(batch, { signal, resourceLimits: limits }));
        batch = [];
        estimatedBytes = 0;
      }
      if (pageBytes > MAX_VISION_BODY_BYTES - 128_000) throw new GoogleOcrOperationalError("vision_page_too_large");
      batch.push(page);
      estimatedBytes += pageBytes;
    }
    if (batch.length) {
      checkHealthy();
      appendResponses(await annotateBatch(batch, { signal, resourceLimits: limits }));
      checkHealthy();
    }
    return { responses, redactionCounts: totalCounts, redactionRegions, redactedPages };
  }

  return { inspectAndRedact, annotateBatch, redactAndAnnotate };
}

export const GOOGLE_OCR_INFO_TYPES = Object.freeze([...DLP_REDACTION_INFO_TYPES]);
