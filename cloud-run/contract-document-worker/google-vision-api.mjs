import https from "node:https";
import sharp from "sharp";

import {
  MAX_VISION_REQUEST_BODY_BYTES,
  MAX_VISION_RESPONSE_BYTES_PER_BATCH,
  resolveDocumentResourceLimits,
} from "./resource-limits.mjs";

const VISION_HOST = "eu-vision.googleapis.com";
const MAX_VISION_IMAGES = 16;
const VISION_BODY_MARGIN_BYTES = 128_000;
const MIN_VISION_LONG_EDGE = 1_200;
const MAX_VISION_DOWNSCALE_ATTEMPTS = 7;
const VISION_RESPONSE_RECOVERY_SCALE = 0.75;
const MAX_VISION_RESPONSE_RECOVERY_ATTEMPTS = 1;
export const MAX_VISION_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VISION_IMAGE_PIXELS = 75_000_000;
const VISION_RESPONSE_FIELDS = "responses(error,fullTextAnnotation/pages)";
const UNREADABLE_PAGE_VARIANT_QUALITY = 96;
const ORIENTATION_PAGE_VARIANT_QUALITY = 96;
const ORIENTATION_ROTATIONS = Object.freeze([0, 90, 180, 270]);

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
  if (!projectId || !/^[a-z][a-z0-9-]{3,62}$/.test(projectId) || visionLocation !== "eu") {
    throw new GoogleOcrOperationalError("invalid_google_ocr_configuration");
  }
  return { projectId, visionLocation, visionEndpoint: `https://${VISION_HOST}` };
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new GoogleOcrOperationalError("google_request_failed");
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
    const body = await awaitWithAbort(
      Promise.resolve().then(() => response.json()),
      requestController.signal,
    );
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
  if (url.protocol !== "https:" || url.hostname !== VISION_HOST) {
    throw new GoogleOcrOperationalError("google_endpoint_rejected");
  }
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length > MAX_VISION_REQUEST_BODY_BYTES) {
    throw new GoogleOcrOperationalError("vision_request_too_large");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const request = requestImpl({
      protocol: "https:", hostname: url.hostname, port: 443,
      path: `${url.pathname}${url.search}`, method: "POST",
      minVersion: "TLSv1.3", rejectUnauthorized: true, timeout: 60_000,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": body.length,
        ...(quotaProject ? { "x-goog-user-project": quotaProject } : {}),
      },
    }, (response) => {
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_VISION_RESPONSE_BYTES_PER_BATCH) {
          request.destroy(new GoogleOcrOperationalError("vision_response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          finish(reject, new GoogleOcrOperationalError(`vision_api_${response.statusCode || "failed"}`));
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
    request.on("socket", (socket) => socket.once("secureConnect", () => {
      if (socket.getProtocol?.() !== "TLSv1.3") {
        request.destroy(new GoogleOcrOperationalError("google_tls_version_rejected"));
      }
    }));
    request.on("timeout", () => request.destroy(new GoogleOcrOperationalError("google_request_timeout")));
    request.on("error", (error) => finish(reject, signal?.aborted
      ? abortReason(signal)
      : error instanceof GoogleOcrOperationalError
        ? error : new GoogleOcrOperationalError("google_request_failed", { cause: error })));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else request.end(body);
  });
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

async function readImageMetadata(imageBytes) {
  try {
    const metadata = await sharp(imageBytes, {
      failOn: "warning", limitInputPixels: MAX_VISION_IMAGE_PIXELS, sequentialRead: true,
    }).metadata();
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || metadata.width <= 0 || metadata.height <= 0
      || metadata.width * metadata.height > MAX_VISION_IMAGE_PIXELS) {
      throw new Error("invalid_dimensions");
    }
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    throw new GoogleOcrOperationalError("vision_page_invalid", { cause: error });
  }
}

/**
 * Build exactly two deterministic, metadata-free retry images for a page that
 * produced no Vision words. The colour variant preserves tonal information;
 * the grayscale variant applies bounded contrast normalisation and sharpening.
 * Neither variant is accepted on its own: spatial-ocr.mjs requires strict text
 * and geometry agreement before either response can replace an empty page.
 */
export async function createUnreadablePageVisionVariants(imageBytes) {
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length < 1
    || imageBytes.length > MAX_VISION_IMAGE_BYTES) {
    throw new GoogleOcrOperationalError("vision_page_too_large");
  }
  const source = await readImageMetadata(imageBytes);
  try {
    const baseOptions = {
      failOn: "warning",
      limitInputPixels: MAX_VISION_IMAGE_PIXELS,
      sequentialRead: true,
    };
    const colour = await sharp(imageBytes, baseOptions)
      .removeAlpha()
      .toColourspace("srgb")
      .jpeg({ quality: UNREADABLE_PAGE_VARIANT_QUALITY, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const contrastGray = await sharp(imageBytes, baseOptions)
      .greyscale()
      .normalise({ lower: 1, upper: 99 })
      .sharpen({ sigma: 1 })
      .jpeg({ quality: UNREADABLE_PAGE_VARIANT_QUALITY, chromaSubsampling: "4:4:4" })
      .toBuffer();
    for (const bytes of [colour, contrastGray]) {
      if (bytes.length < 1 || bytes.length > MAX_VISION_IMAGE_BYTES) {
        throw new GoogleOcrOperationalError("vision_page_too_large");
      }
    }
    return [
      { kind: "colour", imageBytes: colour, ...source },
      { kind: "contrast_gray", imageBytes: contrastGray, ...source },
    ];
  } catch (error) {
    if (error instanceof GoogleOcrOperationalError) throw error;
    throw new GoogleOcrOperationalError("vision_page_invalid", { cause: error });
  }
}

/**
 * Re-encode one page at the four cardinal rotations. These are bounded,
 * metadata-free transport derivatives used only to obtain independent local
 * orientation evidence. The caller must map every response back to the
 * canonical raster and must never treat a rotation as evidence by itself.
 */
export async function createOrientationPageVisionVariants(imageBytes) {
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length < 1
    || imageBytes.length > MAX_VISION_IMAGE_BYTES) {
    throw new GoogleOcrOperationalError("vision_page_too_large");
  }
  const canonical = await readImageMetadata(imageBytes);
  try {
    const variants = [];
    for (const rotationDegrees of ORIENTATION_ROTATIONS) {
      const image = sharp(imageBytes, {
        failOn: "warning",
        limitInputPixels: MAX_VISION_IMAGE_PIXELS,
        sequentialRead: true,
      })
        .removeAlpha()
        .toColourspace("srgb")
        .rotate(rotationDegrees, { background: "white" });
      const rotated = await image
        .jpeg({ quality: ORIENTATION_PAGE_VARIANT_QUALITY, chromaSubsampling: "4:4:4" })
        .toBuffer({ resolveWithObject: true });
      if (rotated.data.length < 1 || rotated.data.length > MAX_VISION_IMAGE_BYTES
        || !Number.isSafeInteger(rotated.info.width) || !Number.isSafeInteger(rotated.info.height)
        || rotated.info.width < 1 || rotated.info.height < 1) {
        throw new GoogleOcrOperationalError("vision_page_too_large");
      }
      variants.push({
        kind: `rotate_${rotationDegrees}`,
        rotationDegrees,
        canonicalWidth: canonical.width,
        canonicalHeight: canonical.height,
        imageBytes: rotated.data,
      });
    }
    return variants;
  } catch (error) {
    if (error instanceof GoogleOcrOperationalError) throw error;
    throw new GoogleOcrOperationalError("vision_page_invalid", { cause: error });
  }
}

export async function prepareImageForVision(imageBytes, {
  maxRequestBodyBytes = MAX_VISION_REQUEST_BODY_BYTES,
} = {}) {
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length < 1 || imageBytes.length > MAX_VISION_IMAGE_BYTES) {
    throw new GoogleOcrOperationalError("vision_page_too_large");
  }
  if (!Number.isSafeInteger(maxRequestBodyBytes) || maxRequestBodyBytes < 1
    || maxRequestBodyBytes > MAX_VISION_REQUEST_BODY_BYTES) {
    throw new GoogleOcrOperationalError("invalid_vision_request_limit");
  }
  const source = await readImageMetadata(imageBytes);
  let bodySize = visionRequestBodySize([{ imageBytes }]);
  if (bodySize <= maxRequestBodyBytes) {
    return {
      imageBytes, downscaled: false,
      sourceWidth: source.width, sourceHeight: source.height,
      visionWidth: source.width, visionHeight: source.height,
    };
  }
  const sourceLongEdge = Math.max(source.width, source.height);
  const minimumScale = Math.min(sourceLongEdge, MIN_VISION_LONG_EDGE) / sourceLongEdge;
  let scale = 1;
  for (let attempt = 0; attempt < MAX_VISION_DOWNSCALE_ATTEMPTS; attempt += 1) {
    const usableBytes = Math.max(1, maxRequestBodyBytes - VISION_BODY_MARGIN_BYTES);
    const estimatedStep = Math.sqrt(usableBytes / bodySize) * 0.9;
    const nextScale = Math.max(minimumScale, scale * Math.min(0.82, Math.max(0.5, estimatedStep)));
    if (nextScale >= scale) break;
    scale = nextScale;
    const width = Math.max(1, Math.floor(source.width * scale));
    const height = Math.max(1, Math.floor(source.height * scale));
    let resized;
    try {
      resized = await sharp(imageBytes, {
        failOn: "warning", limitInputPixels: MAX_VISION_IMAGE_PIXELS, sequentialRead: true,
      }).resize({ width, height, fit: "fill", kernel: sharp.kernel.lanczos3, withoutEnlargement: true })
        .jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
    } catch (error) {
      throw new GoogleOcrOperationalError("vision_page_too_large", { cause: error });
    }
    bodySize = visionRequestBodySize([{ imageBytes: resized }]);
    if (bodySize <= maxRequestBodyBytes) {
      return {
        imageBytes: resized, downscaled: true,
        sourceWidth: source.width, sourceHeight: source.height,
        visionWidth: width, visionHeight: height,
      };
    }
    if (scale <= minimumScale) break;
  }
  throw new GoogleOcrOperationalError("vision_page_too_large");
}

function visionResponseByteSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch (error) {
    throw new GoogleOcrOperationalError("vision_response_invalid", { cause: error });
  }
}

async function recoverVisionTransportPage(page, transform) {
  if (!transform || transform.recoveryAttempts >= MAX_VISION_RESPONSE_RECOVERY_ATTEMPTS) {
    throw new GoogleOcrOperationalError("vision_response_too_large");
  }
  const currentLongEdge = Math.max(transform.visionWidth, transform.visionHeight);
  const scaledLongEdge = Math.floor(currentLongEdge * VISION_RESPONSE_RECOVERY_SCALE);
  const targetLongEdge = currentLongEdge > MIN_VISION_LONG_EDGE
    ? Math.max(MIN_VISION_LONG_EDGE, scaledLongEdge)
    : scaledLongEdge;
  if (!Number.isSafeInteger(targetLongEdge) || targetLongEdge < 1
    || targetLongEdge >= currentLongEdge) {
    throw new GoogleOcrOperationalError("vision_response_too_large");
  }
  const scale = targetLongEdge / currentLongEdge;
  const width = Math.max(1, Math.floor(transform.visionWidth * scale));
  const height = Math.max(1, Math.floor(transform.visionHeight * scale));
  let resized;
  try {
    resized = await sharp(page.imageBytes, {
      failOn: "warning", limitInputPixels: MAX_VISION_IMAGE_PIXELS, sequentialRead: true,
    }).resize({ width, height, fit: "fill", kernel: sharp.kernel.lanczos3, withoutEnlargement: true })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer();
  } catch (error) {
    throw new GoogleOcrOperationalError("vision_response_too_large", { cause: error });
  }
  const previousRetainedTransportBytes = transform.retainedTransportBytes;
  page.imageBytes = resized;
  transform.visionWidth = width;
  transform.visionHeight = height;
  transform.recoveryAttempts += 1;
  transform.retainedTransportBytes = resized.length;
  return resized.length - previousRetainedTransportBytes;
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
          && (/^vision_api_(?:429|500|502|503|504)$/.test(error.code)
            || ["google_request_timeout", "google_request_failed"].includes(error.code));
        if (!retryable || attempt === 2) throw error;
        await retryDelay(250 * (attempt + 1), { signal });
      }
    }
    throw lastError;
  }

  async function annotateBatch(pages, { signal, resourceLimits } = {}) {
    const limits = resolveDocumentResourceLimits(resourceLimits);
    const payload = buildVisionPayload(pages);
    if (pages.length < 1 || pages.length > MAX_VISION_IMAGES
      || Buffer.byteLength(JSON.stringify(payload)) > limits.maxVisionRequestBodyBytes) {
      throw new GoogleOcrOperationalError("vision_request_too_large");
    }
    const token = await accessTokenProvider({ signal });
    const parent = `projects/${config.projectId}/locations/${config.visionLocation}`;
    const result = await post(
      `${config.visionEndpoint}/v1/${parent}/images:annotate?fields=${encodeURIComponent(VISION_RESPONSE_FIELDS)}`,
      token, payload, { signal },
    );
    if (!Array.isArray(result.responses) || result.responses.length !== pages.length) {
      throw new GoogleOcrOperationalError("vision_response_invalid");
    }
    if (visionResponseByteSize(result.responses) > limits.maxVisionResponseBytesPerBatch) {
      throw new GoogleOcrOperationalError("vision_response_too_large");
    }
    return result.responses;
  }

  async function annotateAdaptivePages(batch, {
    signal,
    limits,
    checkHealthy,
    transformByTransportPage,
    appendResponses,
    adjustRetainedRasterBytes,
  }) {
    checkHealthy();
    try {
      appendResponses(await annotateBatch(batch, { signal, resourceLimits: limits }));
    } catch (error) {
      if (!(error instanceof GoogleOcrOperationalError)
        || error.code !== "vision_response_too_large"
        || error.documentBudgetExceeded === true) throw error;
      if (batch.length === 1) {
        const page = batch[0];
        const transform = transformByTransportPage.get(page);
        adjustRetainedRasterBytes(await recoverVisionTransportPage(page, transform));
        appendResponses(await annotateBatch([page], { signal, resourceLimits: limits }));
        return;
      }
      const middle = Math.ceil(batch.length / 2);
      await annotateAdaptivePages(batch.slice(0, middle), {
        signal, limits, checkHealthy, transformByTransportPage,
        appendResponses, adjustRetainedRasterBytes,
      });
      await annotateAdaptivePages(batch.slice(middle), {
        signal, limits, checkHealthy, transformByTransportPage,
        appendResponses, adjustRetainedRasterBytes,
      });
    }
  }

  async function annotateDocument(pages, {
    assertHealthy = () => {}, resourceLimits, signal,
  } = {}) {
    const checkHealthy = () => {
      throwIfAborted(signal);
      assertHealthy();
      throwIfAborted(signal);
    };
    const limits = resolveDocumentResourceLimits(resourceLimits);
    if (pages.length < 1 || pages.length > limits.maxDocumentPages) {
      throw new GoogleOcrOperationalError("document_page_limit_exceeded");
    }
    let retainedRasterBytes = 0;
    const sourcePages = [];
    const visionPages = [];
    const visionPageTransforms = [];
    for (const page of pages) {
      checkHealthy();
      retainedRasterBytes += page?.imageBytes?.length ?? 0;
      if (retainedRasterBytes > limits.maxDocumentRasterBytes) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
      }
      const prepared = await prepareImageForVision(page.imageBytes, {
        maxRequestBodyBytes: limits.maxVisionRequestBodyBytes,
      });
      if (prepared.downscaled) retainedRasterBytes += prepared.imageBytes.length;
      if (retainedRasterBytes > limits.maxDocumentTotalRasterBytes) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
      }
      sourcePages.push(page);
      visionPages.push({ ...page, imageBytes: prepared.imageBytes });
      visionPageTransforms.push({
        pageNumber: page.pageNumber,
        sourceWidth: prepared.sourceWidth, sourceHeight: prepared.sourceHeight,
        visionWidth: prepared.visionWidth, visionHeight: prepared.visionHeight,
        recoveryAttempts: 0,
        retainedTransportBytes: prepared.downscaled ? prepared.imageBytes.length : 0,
      });
    }

    const responses = [];
    let retainedVisionResponseBytes = 0;
    const appendResponses = (batchResponses) => {
      const nextRetainedBytes = retainedVisionResponseBytes + visionResponseByteSize(batchResponses);
      if (nextRetainedBytes > limits.maxVisionResponseBytesTotal) {
        const error = new GoogleOcrOperationalError("vision_response_too_large");
        error.documentBudgetExceeded = true;
        throw error;
      }
      retainedVisionResponseBytes = nextRetainedBytes;
      responses.push(...batchResponses);
    };
    const transformByTransportPage = new Map(visionPages.map((page, index) => [
      page,
      visionPageTransforms[index],
    ]));
    const adjustRetainedRasterBytes = (delta) => {
      retainedRasterBytes += delta;
      if (retainedRasterBytes > limits.maxDocumentTotalRasterBytes) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
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
        await annotateAdaptivePages(batch, {
          signal, limits, checkHealthy, transformByTransportPage,
          appendResponses, adjustRetainedRasterBytes,
        });
        batch = [];
        estimatedBytes = 0;
      }
      batch.push(page);
      estimatedBytes += pageBytes;
    }
    if (batch.length) {
      await annotateAdaptivePages(batch, {
        signal, limits, checkHealthy, transformByTransportPage,
        appendResponses, adjustRetainedRasterBytes,
      });
    }
    checkHealthy();
    return {
      responses,
      sourcePages,
      visionPageTransforms,
      retainedRasterBytes,
      retainedVisionResponseBytes,
    };
  }

  async function annotatePageVariants(page, {
    assertHealthy = () => {},
    resourceLimits,
    signal,
    maxAdditionalRasterBytes,
    maxAdditionalResponseBytes,
  } = {}, createVariants) {
    const checkHealthy = () => {
      throwIfAborted(signal);
      assertHealthy();
      throwIfAborted(signal);
    };
    const limits = resolveDocumentResourceLimits(resourceLimits);
    if (!Number.isSafeInteger(page?.pageNumber) || page.pageNumber < 1) {
      throw new GoogleOcrOperationalError("vision_page_invalid");
    }
    const rasterBudget = maxAdditionalRasterBytes == null
      ? limits.maxDocumentTotalRasterBytes
      : Math.min(limits.maxDocumentTotalRasterBytes, Number(maxAdditionalRasterBytes));
    const responseBudget = maxAdditionalResponseBytes == null
      ? limits.maxVisionResponseBytesTotal
      : Math.min(limits.maxVisionResponseBytesTotal, Number(maxAdditionalResponseBytes));
    if (!Number.isSafeInteger(rasterBudget) || rasterBudget < 1
      || !Number.isSafeInteger(responseBudget) || responseBudget < 1) {
      throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
    }

    checkHealthy();
    const variants = await createVariants(page.imageBytes);
    let retainedRasterBytes = 0;
    const preparedPages = [];
    const transforms = [];
    for (const variant of variants) {
      checkHealthy();
      retainedRasterBytes += variant.imageBytes.length;
      const prepared = await prepareImageForVision(variant.imageBytes, {
        maxRequestBodyBytes: limits.maxVisionRequestBodyBytes,
      });
      if (prepared.downscaled) retainedRasterBytes += prepared.imageBytes.length;
      if (retainedRasterBytes > rasterBudget) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
      }
      preparedPages.push({ imageBytes: prepared.imageBytes });
      transforms.push({
        kind: variant.kind,
        ...(Number.isSafeInteger(variant.rotationDegrees) ? {
          rotationDegrees: variant.rotationDegrees,
          canonicalWidth: variant.canonicalWidth,
          canonicalHeight: variant.canonicalHeight,
        } : {}),
        pageNumber: page.pageNumber,
        sourceWidth: prepared.sourceWidth,
        sourceHeight: prepared.sourceHeight,
        visionWidth: prepared.visionWidth,
        visionHeight: prepared.visionHeight,
        recoveryAttempts: 0,
        retainedTransportBytes: prepared.downscaled ? prepared.imageBytes.length : 0,
      });
    }

    const responses = [];
    let retainedVisionResponseBytes = 0;
    const appendResponses = (batchResponses) => {
      const nextRetainedBytes = retainedVisionResponseBytes + visionResponseByteSize(batchResponses);
      if (nextRetainedBytes > responseBudget) {
        const error = new GoogleOcrOperationalError("vision_response_too_large");
        error.documentBudgetExceeded = true;
        throw error;
      }
      retainedVisionResponseBytes = nextRetainedBytes;
      responses.push(...batchResponses);
    };
    const transformByTransportPage = new Map(preparedPages.map((preparedPage, index) => [
      preparedPage,
      transforms[index],
    ]));
    const adjustRetainedRasterBytes = (delta) => {
      retainedRasterBytes += delta;
      if (retainedRasterBytes > rasterBudget) {
        throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
      }
    };
    let batch = [];
    let estimatedBytes = 0;
    for (const preparedPage of preparedPages) {
      const pageBytes = visionRequestBodySize([preparedPage]);
      if (pageBytes > limits.maxVisionRequestBodyBytes) {
        throw new GoogleOcrOperationalError("vision_page_too_large");
      }
      if (batch.length && (batch.length >= MAX_VISION_IMAGES
        || estimatedBytes + pageBytes > limits.maxVisionRequestBodyBytes - VISION_BODY_MARGIN_BYTES)) {
        await annotateAdaptivePages(batch, {
          signal, limits, checkHealthy, transformByTransportPage,
          appendResponses, adjustRetainedRasterBytes,
        });
        batch = [];
        estimatedBytes = 0;
      }
      batch.push(preparedPage);
      estimatedBytes += pageBytes;
    }
    if (batch.length) {
      await annotateAdaptivePages(batch, {
        signal, limits, checkHealthy, transformByTransportPage,
        appendResponses, adjustRetainedRasterBytes,
      });
    }
    checkHealthy();
    return {
      variants: responses.map((response, index) => ({
        kind: transforms[index].kind,
        response,
        transform: transforms[index],
      })),
      retainedRasterBytes,
      retainedVisionResponseBytes,
    };
  }

  async function annotateUnreadablePageVariants(page, options = {}) {
    return annotatePageVariants(page, options, createUnreadablePageVisionVariants);
  }

  async function annotateOrientationPageVariants(page, options = {}) {
    return annotatePageVariants(page, options, createOrientationPageVisionVariants);
  }

  return {
    annotateBatch,
    annotateDocument,
    annotateUnreadablePageVariants,
    annotateOrientationPageVariants,
  };
}
