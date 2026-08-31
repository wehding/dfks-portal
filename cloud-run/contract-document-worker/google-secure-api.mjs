import https from "node:https";
import sharp from "sharp";

import {
  MAX_VISION_REQUEST_BODY_BYTES,
  MAX_VISION_RESPONSE_BYTES_PER_BATCH,
  resolveDocumentResourceLimits,
} from "./resource-limits.mjs";

const VISION_HOST = "eu-vision.googleapis.com";
const DLP_HOST = "dlp.eu.rep.googleapis.com";
const MAX_VISION_IMAGES = 16;
const VISION_BODY_MARGIN_BYTES = 128_000;
const MIN_VISION_LONG_EDGE = 1_200;
const MAX_VISION_DOWNSCALE_ATTEMPTS = 7;
const VISION_RESPONSE_RECOVERY_SCALE = 0.75;
const MAX_VISION_RESPONSE_RECOVERY_ATTEMPTS = 1;
const VISION_RESPONSE_FIELDS = "responses(error,fullTextAnnotation/pages)";
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

function parseProtoJsonNonNegativeInteger(value, { defaultZero = false } = {}) {
  if (value == null && defaultZero) return 0;
  if (Number.isSafeInteger(value) && value >= 0) return value;
  // ProtoJSON may represent integer fields as decimal strings. Accept only a
  // canonical, unsigned base-10 form; whitespace, signs, exponents, fractions
  // and unsafe values remain fail-closed.
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  throw new GoogleOcrOperationalError("dlp_location_invalid");
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

async function awaitWithAbort(promise, signal) {
  throwIfAborted(signal);
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
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

export async function fetchGoogleAccessToken(fetchImpl = fetch, { signal, timeoutMs = 10_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new GoogleOcrOperationalError("google_access_token_failed");
  }
  throwIfAborted(signal);
  const requestController = new AbortController();
  const onAbort = () => requestController.abort(abortReason(signal));
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    requestController.abort(new GoogleOcrOperationalError("google_access_token_failed"));
  }, timeoutMs);
  try {
    const response = await fetchImpl(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        signal: requestController.signal,
      },
    );
    if (!response.ok) throw new GoogleOcrOperationalError("google_access_token_failed");
    throwIfAborted(requestController.signal);
    let body;
    try {
      body = await awaitWithAbort(Promise.resolve().then(() => response.json()), requestController.signal);
      throwIfAborted(requestController.signal);
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      throw new GoogleOcrOperationalError("google_access_token_failed", { cause: error });
    }
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new GoogleOcrOperationalError("google_access_token_failed");
    }
    return body.access_token;
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    if (error instanceof GoogleOcrOperationalError) throw error;
    throw new GoogleOcrOperationalError("google_access_token_failed", { cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
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
    const contentLocations = finding?.location?.contentLocations;
    if (!Array.isArray(contentLocations) || contentLocations.length === 0) {
      unlocatedFindings += 1;
      continue;
    }
    for (const location of contentLocations) {
      const boundingBoxes = location?.imageLocation?.boundingBoxes;
      if (!Array.isArray(boundingBoxes) || boundingBoxes.length === 0) {
        unlocatedFindings += 1;
        continue;
      }
      let locationHasBox = false;
      for (const box of boundingBoxes) {
        // ProtoJSON may omit scalar fields whose value is the default zero.
        // A DLP box at the top or left image edge is therefore valid even when
        // `top` or `left` is absent from the JSON response. Width and height,
        // however, must always be present and strictly positive.
        const top = parseProtoJsonNonNegativeInteger(box?.top, { defaultZero: true });
        const left = parseProtoJsonNonNegativeInteger(box?.left, { defaultZero: true });
        const parsed = {
          top,
          left,
          width: parseProtoJsonNonNegativeInteger(box?.width),
          height: parseProtoJsonNonNegativeInteger(box?.height),
        };
        if (parsed.width > 0 && parsed.height > 0) {
          boxes.push({ ...parsed, infoType: name });
          locationHasBox = true;
        } else {
          throw new GoogleOcrOperationalError("dlp_location_invalid");
        }
      }
      if (!locationHasBox) unlocatedFindings += 1;
    }
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

function buildVisionPayload(pages) {
  return {
    requests: pages.map((page) => ({
      image: { content: page.imageBytes.toString("base64") },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      imageContext: { languageHints: ["da", "en"] },
    })),
  };
}

export function visionRequestBodySize(pages) {
  return Buffer.byteLength(JSON.stringify(buildVisionPayload(pages)));
}

function scaleBoxesForImage(boxes, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  return boxes.map((box) => {
    const left = Math.max(0, Math.floor(box.left * scaleX));
    const top = Math.max(0, Math.floor(box.top * scaleY));
    const right = Math.min(targetWidth, Math.ceil((box.left + box.width) * scaleX));
    const bottom = Math.min(targetHeight, Math.ceil((box.top + box.height) * scaleY));
    if (right <= left || bottom <= top) {
      throw new GoogleOcrOperationalError("dlp_location_invalid");
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

async function resizeAndVerifyRedactedImage(
  imageBytes,
  boxes,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
) {
  let raw;
  try {
    raw = await imageReader(imageBytes)
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: true,
      })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new GoogleOcrOperationalError("vision_page_too_large", { cause: error });
  }
  if (raw.info.width !== targetWidth || raw.info.height !== targetHeight || raw.info.channels < 3) {
    throw new GoogleOcrOperationalError("vision_page_too_large");
  }
  const scaledBoxes = scaleBoxesForImage(
    boxes,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
  );
  // Resampling may blend pixels along a mask edge. Reapply every DLP mask to
  // the resized raster and verify exact black pixels before Vision can receive
  // it. This keeps the DLP-first, fail-closed security boundary intact.
  overwriteAndVerifyBlackPixels(
    raw.data,
    raw.info.channels,
    raw.info.width,
    scaledBoxes,
  );
  let resizedPng;
  try {
    resizedPng = await sharp(raw.data, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      },
    }).png({ compressionLevel: 9, palette: false }).toBuffer();
  } catch (error) {
    throw new GoogleOcrOperationalError("vision_page_too_large", { cause: error });
  }
  if (!resizedPng.length || resizedPng.length > MAX_DLP_REDACTED_IMAGE_BYTES
    || resizedPng[0] !== 0x89 || resizedPng.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new GoogleOcrOperationalError("vision_page_too_large");
  }
  return { imageBytes: resizedPng, boxes: scaledBoxes };
}

async function recoverVisionTransportPage(page, transport) {
  if (!transport || transport.recoveryAttempts >= MAX_VISION_RESPONSE_RECOVERY_ATTEMPTS) {
    throw new GoogleOcrOperationalError("vision_response_too_large");
  }
  const currentLongEdge = Math.max(transport.visionWidth, transport.visionHeight);
  const scaledLongEdge = Math.floor(currentLongEdge * VISION_RESPONSE_RECOVERY_SCALE);
  const targetLongEdge = currentLongEdge > MIN_VISION_LONG_EDGE
    ? Math.max(MIN_VISION_LONG_EDGE, scaledLongEdge)
    : scaledLongEdge;
  if (!Number.isSafeInteger(targetLongEdge) || targetLongEdge < 1 || targetLongEdge >= currentLongEdge) {
    throw new GoogleOcrOperationalError("vision_response_too_large");
  }
  const scale = targetLongEdge / currentLongEdge;
  const targetWidth = Math.max(1, Math.floor(transport.visionWidth * scale));
  const targetHeight = Math.max(1, Math.floor(transport.visionHeight * scale));
  const resized = await resizeAndVerifyRedactedImage(
    page.imageBytes,
    transport.boxes,
    transport.visionWidth,
    transport.visionHeight,
    targetWidth,
    targetHeight,
  );
  const previousRetainedTransportBytes = transport.retainedTransportBytes ?? 0;
  page.imageBytes = resized.imageBytes;
  transport.boxes = resized.boxes;
  transport.visionWidth = targetWidth;
  transport.visionHeight = targetHeight;
  transport.recoveryAttempts += 1;
  transport.retainedTransportBytes = resized.imageBytes.length;
  transport.transform.visionWidth = targetWidth;
  transport.transform.visionHeight = targetHeight;
  return resized.imageBytes.length - previousRetainedTransportBytes;
}

/**
 * DLP always sees the higher-resolution source first. Only the already
 * redacted, canonical PNG may be reduced for Vision. Coordinates are mapped
 * outwards and masks are reapplied after resampling, so no sensitive pixels
 * can reappear through interpolation.
 */
export async function prepareRedactedImageForVision(imageBytes, boxes, {
  maxRequestBodyBytes = MAX_VISION_REQUEST_BODY_BYTES,
} = {}) {
  if (!Number.isSafeInteger(maxRequestBodyBytes) || maxRequestBodyBytes < 1
    || maxRequestBodyBytes > MAX_VISION_REQUEST_BODY_BYTES) {
    throw new GoogleOcrOperationalError("invalid_vision_request_limit");
  }
  const sourceMetadata = await readImageMetadata(imageBytes);
  const safeBoxes = normaliseAndValidateBoxes(
    boxes,
    sourceMetadata.width,
    sourceMetadata.height,
  );
  let currentBodySize = visionRequestBodySize([{ imageBytes }]);
  if (currentBodySize <= maxRequestBodyBytes) {
    return {
      imageBytes,
      boxes: safeBoxes,
      downscaled: false,
      sourceWidth: sourceMetadata.width,
      sourceHeight: sourceMetadata.height,
      visionWidth: sourceMetadata.width,
      visionHeight: sourceMetadata.height,
    };
  }

  const sourceLongEdge = Math.max(sourceMetadata.width, sourceMetadata.height);
  const minimumLongEdge = Math.min(sourceLongEdge, MIN_VISION_LONG_EDGE);
  const minimumScale = minimumLongEdge / sourceLongEdge;
  let scale = 1;
  for (let attempt = 0; attempt < MAX_VISION_DOWNSCALE_ATTEMPTS; attempt += 1) {
    const usableBytes = Math.max(1, maxRequestBodyBytes - VISION_BODY_MARGIN_BYTES);
    const estimatedStep = Math.sqrt(usableBytes / currentBodySize) * 0.9;
    const nextScale = Math.max(
      minimumScale,
      scale * Math.min(0.82, Math.max(0.5, estimatedStep)),
    );
    if (nextScale >= scale) break;
    scale = nextScale;
    const targetWidth = Math.max(1, Math.floor(sourceMetadata.width * scale));
    const targetHeight = Math.max(1, Math.floor(sourceMetadata.height * scale));
    const resized = await resizeAndVerifyRedactedImage(
      imageBytes,
      safeBoxes,
      sourceMetadata.width,
      sourceMetadata.height,
      targetWidth,
      targetHeight,
    );
    currentBodySize = visionRequestBodySize([{ imageBytes: resized.imageBytes }]);
    if (currentBodySize <= maxRequestBodyBytes) {
      return {
        ...resized,
        downscaled: true,
        sourceWidth: sourceMetadata.width,
        sourceHeight: sourceMetadata.height,
        visionWidth: targetWidth,
        visionHeight: targetHeight,
      };
    }
    if (scale <= minimumScale) break;
  }
  throw new GoogleOcrOperationalError("vision_page_too_large");
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

  async function inspectAndRedact(imageBytes, { resourceLimits, signal } = {}) {
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
    // The source has already passed DLP at full render resolution. A large,
    // lossless canonical PNG can now be safely reduced to fit the synchronous
    // Vision request while preserving outward-rounded redaction geometry.
    const visionSafe = await prepareRedactedImageForVision(
      canonical.imageBytes,
      canonical.boxes,
      { maxRequestBodyBytes: resolveDocumentResourceLimits(resourceLimits).maxVisionRequestBodyBytes },
    );
    return {
      // The canonical full-resolution DLP result is the immutable derivative
      // source. A smaller transport copy may be sent to Vision, but must never
      // replace the page persisted in the searchable PDF.
      canonicalImageBytes: canonical.imageBytes,
      visionImageBytes: visionSafe.imageBytes,
      counts,
      canonicalBoxes: canonical.boxes,
      visionBoxes: visionSafe.boxes,
      downscaledForVision: visionSafe.downscaled,
      sourceWidth: visionSafe.sourceWidth,
      sourceHeight: visionSafe.sourceHeight,
      visionWidth: visionSafe.visionWidth,
      visionHeight: visionSafe.visionHeight,
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
    const limits = resolveDocumentResourceLimits(resourceLimits);
    const parent = `projects/${config.projectId}/locations/${config.visionLocation}`;
    const payload = buildVisionPayload(pages);
    if (Buffer.byteLength(JSON.stringify(payload)) > limits.maxVisionRequestBodyBytes) {
      throw new GoogleOcrOperationalError("vision_request_too_large");
    }
    const token = await accessTokenProvider({ signal });
    throwIfAborted(signal);
    const result = await post(
      `${config.visionEndpoint}/v1/${parent}/images:annotate?fields=${encodeURIComponent(VISION_RESPONSE_FIELDS)}`,
      token,
      payload,
      { signal },
    );
    if (!Array.isArray(result.responses) || result.responses.length !== pages.length) {
      throw new GoogleOcrOperationalError("vision_response_invalid");
    }
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
    const visionPages = [];
    const visionPageTransforms = [];
    const visionTransportByPage = new Map();
    const totalCounts = {};
    const redactionRegions = [];
    for (const page of pages) {
      checkHealthy();
      // Fail closed: a DLP error prevents the page from reaching Vision.
      const redacted = await inspectAndRedact(page.imageBytes, { resourceLimits: limits, signal });
      checkHealthy();
      retainedRasterBytes += redacted.canonicalImageBytes.length;
      if (redacted.downscaledForVision) {
        retainedRasterBytes += redacted.visionImageBytes.length;
      }
      if (retainedRasterBytes > limits.maxDocumentTotalRasterBytes) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
      }
      for (const [name, count] of Object.entries(redacted.counts)) {
        totalCounts[name] = (totalCounts[name] ?? 0) + count;
      }
      redactionRegions.push(...redacted.canonicalBoxes.map((box) => ({
        pageNumber: page.pageNumber,
        ...box,
      })));
      redactedPages.push({ ...page, imageBytes: redacted.canonicalImageBytes });
      const visionPage = { ...page, imageBytes: redacted.visionImageBytes };
      const transform = {
        pageNumber: page.pageNumber,
        sourceWidth: redacted.sourceWidth,
        sourceHeight: redacted.sourceHeight,
        visionWidth: redacted.visionWidth,
        visionHeight: redacted.visionHeight,
      };
      visionPages.push(visionPage);
      visionPageTransforms.push(transform);
      visionTransportByPage.set(page.pageNumber, {
        boxes: redacted.visionBoxes,
        visionWidth: redacted.visionWidth,
        visionHeight: redacted.visionHeight,
        recoveryAttempts: 0,
        // A transport buffer that aliases the canonical PNG is already
        // counted once. Only a separate downscaled transport copy contributes
        // extra retained bytes, and a later replacement subtracts that copy.
        retainedTransportBytes: redacted.downscaledForVision
          ? redacted.visionImageBytes.length
          : 0,
        transform,
      });
    }

    const responses = [];
    let retainedVisionResponseBytes = 0;
    const appendResponses = (batchResponses) => {
      const nextRetainedBytes = retainedVisionResponseBytes + visionResponseByteSize(batchResponses);
      if (nextRetainedBytes > limits.maxVisionResponseBytesTotal) {
        const error = new GoogleOcrOperationalError("vision_response_too_large");
        // A document-wide budget exhaustion cannot be repaired by changing
        // the raster of the current page. Keep the public diagnostic code,
        // but prevent the single-page transport retry from doing extra work.
        error.documentBudgetExceeded = true;
        throw error;
      }
      retainedVisionResponseBytes = nextRetainedBytes;
      responses.push(...batchResponses);
    };
    const annotateAdaptive = async (pagesInBatch) => {
      checkHealthy();
      try {
        const batchResponses = await annotateBatch(pagesInBatch, { signal, resourceLimits: limits });
        checkHealthy();
        // Account for each successful leaf immediately. Returning recursively
        // concatenated arrays would temporarily retain a second copy of a
        // potentially large Vision response before the document-wide budget
        // was enforced.
        appendResponses(batchResponses);
        return;
      } catch (error) {
        if (!(error instanceof GoogleOcrOperationalError)
          || error.code !== "vision_response_too_large") throw error;
        if (error.documentBudgetExceeded === true) throw error;
        if (pagesInBatch.length === 1) {
          const page = pagesInBatch[0];
          const retainedByteDelta = await recoverVisionTransportPage(
            page,
            visionTransportByPage.get(page.pageNumber),
          );
          retainedRasterBytes += retainedByteDelta;
          if (retainedRasterBytes > limits.maxDocumentTotalRasterBytes) {
            throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
          }
          checkHealthy();
          const recoveredResponses = await annotateBatch([page], { signal, resourceLimits: limits });
          checkHealthy();
          appendResponses(recoveredResponses);
          return;
        }
        // A dense group may exceed Google's or our bounded response body even
        // though each page is valid. Split deterministically, keep order, and
        // retain the document-wide response budget.
        const middle = Math.ceil(pagesInBatch.length / 2);
        await annotateAdaptive(pagesInBatch.slice(0, middle));
        checkHealthy();
        await annotateAdaptive(pagesInBatch.slice(middle));
        checkHealthy();
      }
    };
    let batch = [];
    let estimatedBytes = 0;
    for (const page of visionPages) {
      const pageBytes = visionRequestBodySize([page]);
      if (pageBytes > limits.maxVisionRequestBodyBytes) {
        throw new GoogleOcrOperationalError("vision_page_too_large");
      }
      if (batch.length && (batch.length >= MAX_VISION_IMAGES
        || estimatedBytes + pageBytes > limits.maxVisionRequestBodyBytes - VISION_BODY_MARGIN_BYTES)) {
        checkHealthy();
        await annotateAdaptive(batch);
        batch = [];
        estimatedBytes = 0;
      }
      batch.push(page);
      estimatedBytes += pageBytes;
    }
    if (batch.length) {
      checkHealthy();
      await annotateAdaptive(batch);
      checkHealthy();
    }
    return {
      responses,
      redactionCounts: totalCounts,
      redactionRegions,
      redactedPages,
      visionPageTransforms,
    };
  }

  return { inspectAndRedact, annotateBatch, redactAndAnnotate };
}

export const GOOGLE_OCR_INFO_TYPES = Object.freeze([...DLP_REDACTION_INFO_TYPES]);
