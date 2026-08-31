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
const MIN_VISION_LONG_EDGE = 1_600;
const MAX_VISION_DOWNSCALE_ATTEMPTS = 6;
export const MAX_VISION_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VISION_IMAGE_PIXELS = 75_000_000;
const VISION_RESPONSE_FIELDS = "responses(error,fullTextAnnotation/pages)";

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
      });
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
    const annotateAdaptive = async (batch) => {
      checkHealthy();
      try {
        appendResponses(await annotateBatch(batch, { signal, resourceLimits: limits }));
      } catch (error) {
        if (!(error instanceof GoogleOcrOperationalError)
          || error.code !== "vision_response_too_large" || batch.length <= 1) throw error;
        const middle = Math.ceil(batch.length / 2);
        await annotateAdaptive(batch.slice(0, middle));
        await annotateAdaptive(batch.slice(middle));
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
        await annotateAdaptive(batch);
        batch = [];
        estimatedBytes = 0;
      }
      batch.push(page);
      estimatedBytes += pageBytes;
    }
    if (batch.length) await annotateAdaptive(batch);
    checkHealthy();
    return { responses, sourcePages, visionPageTransforms };
  }

  return { annotateBatch, annotateDocument };
}
