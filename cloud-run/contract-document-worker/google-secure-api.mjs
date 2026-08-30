import https from "node:https";
import { createHash } from "node:crypto";

const VISION_HOST = "eu-vision.googleapis.com";
const DLP_HOST = "dlp.eu.rep.googleapis.com";
const MAX_VISION_IMAGES = 16;
const MAX_VISION_BODY_BYTES = 8 * 1024 * 1024;
const MAX_DLP_BOXES_PER_PAGE = 2_000;
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
  const dlpLocation = env.GOOGLE_DLP_LOCATION?.trim() || "eu";
  if (!projectId || !/^[a-z][a-z0-9-]{3,62}$/.test(projectId)
    || visionLocation !== "eu" || dlpLocation !== "eu") {
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

export async function fetchGoogleAccessToken(fetchImpl = fetch) {
  const response = await fetchImpl(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
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
} = {}) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || ![VISION_HOST, DLP_HOST].includes(url.hostname)) {
    throw new GoogleOcrOperationalError("google_endpoint_rejected");
  }
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
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
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > 50 * 1024 * 1024) {
          request.destroy(new Error("google_response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new GoogleOcrOperationalError(`google_api_${response.statusCode || "failed"}`));
          return;
        }
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch {
          reject(new GoogleOcrOperationalError("google_response_invalid"));
        }
      });
    });
    request.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        if (socket.getProtocol?.() !== "TLSv1.3") {
            request.destroy(new GoogleOcrOperationalError("google_tls_version_rejected"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new GoogleOcrOperationalError("google_request_timeout")));
    request.on("error", (error) => reject(error instanceof GoogleOcrOperationalError
      ? error : new GoogleOcrOperationalError("google_request_failed", { cause: error })));
    request.end(body);
  });
}

export function extractDlpFindings(response) {
  const counts = {};
  const boxes = [];
  const findings = response?.inspectResult?.findings ?? response?.result?.findings ?? [];
  for (const finding of findings) {
    const name = finding?.infoType?.name;
    if (!DLP_REDACTION_INFO_TYPES.includes(name)) continue;
    counts[name] = (counts[name] ?? 0) + 1;
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
        }
      }
    }
  }
  if (boxes.length > MAX_DLP_BOXES_PER_PAGE) {
    throw new GoogleOcrOperationalError("dlp_too_many_locations");
  }
  return { counts, boxes };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeDlpRedactedImage(response, originalImage, findingCount) {
  if (typeof response?.redactedImage !== "string" || !response.redactedImage) {
    throw new GoogleOcrOperationalError("dlp_redacted_image_missing");
  }
  const image = Buffer.from(response.redactedImage, "base64");
  if (!image.length || image.length > 16 * 1024 * 1024
    || image[0] !== 0xff || image[1] !== 0xd8) {
    throw new GoogleOcrOperationalError("dlp_redacted_image_invalid");
  }
  if (findingCount > 0 && digest(image) === digest(originalImage)) {
    throw new GoogleOcrOperationalError("dlp_redaction_not_applied");
  }
  return image;
}

export function createGoogleOcrClient({
  config = readGoogleConfig(),
  accessTokenProvider = fetchGoogleAccessToken,
  jsonPost = secureJsonPost,
  retryDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  async function post(url, token, payload) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await jsonPost(url, token, payload, { quotaProject: config.projectId });
      } catch (error) {
        lastError = error;
        const retryable = error instanceof GoogleOcrOperationalError
          && ["google_api_429", "google_api_500", "google_api_502", "google_api_503", "google_api_504", "google_request_timeout", "google_request_failed"].includes(error.code);
        if (!retryable || attempt === 2) throw error;
        await retryDelay(250 * (attempt + 1));
      }
    }
    throw lastError;
  }

  async function inspectAndRedact(imageBytes) {
    const token = await accessTokenProvider();
    const byteItem = { type: "IMAGE_JPEG", data: imageBytes.toString("base64") };
    const inspectConfig = {
      infoTypes: DLP_INFO_TYPES.map((name) => ({ name })),
      customInfoTypes: DLP_CUSTOM_INFO_TYPES,
      minLikelihood: "POSSIBLE",
      includeQuote: false,
    };
    const parent = `projects/${config.projectId}/locations/${config.dlpLocation}`;
    const redacted = await post(
      `${config.dlpEndpoint}/v2/${parent}/image:redact`,
      token,
      {
        inspectConfig,
        imageRedactionConfigs: DLP_REDACTION_INFO_TYPES.map((name) => ({ infoType: { name } })),
        includeFindings: true,
        byteItem,
      },
    );
    const { counts, boxes } = extractDlpFindings(redacted);
    if (Object.keys(counts).length > 0 && boxes.length === 0) {
      // Fail closed rather than sending a known sensitive page to Vision without
      // auditable redaction geometry.
      throw new GoogleOcrOperationalError("dlp_location_missing");
    }
    return {
      imageBytes: decodeDlpRedactedImage(
        redacted,
        imageBytes,
        Object.values(counts).reduce((sum, count) => sum + count, 0),
      ),
      counts,
      boxes,
    };
  }

  async function annotateBatch(pages) {
    const token = await accessTokenProvider();
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
    );
    if (!Array.isArray(result.responses) || result.responses.length !== pages.length) {
      throw new GoogleOcrOperationalError("vision_response_invalid");
    }
    return result.responses;
  }

  async function redactAndAnnotate(pages) {
    const redactedPages = [];
    const totalCounts = {};
    const redactionRegions = [];
    for (const page of pages) {
      // Fail closed: a DLP error prevents the page from reaching Vision.
      const redacted = await inspectAndRedact(page.imageBytes);
      for (const [name, count] of Object.entries(redacted.counts)) {
        totalCounts[name] = (totalCounts[name] ?? 0) + count;
      }
      redactionRegions.push(...redacted.boxes.map((box) => ({ pageNumber: page.pageNumber, ...box })));
      redactedPages.push({ ...page, imageBytes: redacted.imageBytes });
    }

    const responses = [];
    let batch = [];
    let estimatedBytes = 0;
    for (const page of redactedPages) {
      const pageBytes = Math.ceil(page.imageBytes.length * 4 / 3) + 1024;
      if (batch.length && (batch.length >= MAX_VISION_IMAGES || estimatedBytes + pageBytes > MAX_VISION_BODY_BYTES - 128_000)) {
        responses.push(...await annotateBatch(batch));
        batch = [];
        estimatedBytes = 0;
      }
      if (pageBytes > MAX_VISION_BODY_BYTES - 128_000) throw new GoogleOcrOperationalError("vision_page_too_large");
      batch.push(page);
      estimatedBytes += pageBytes;
    }
    if (batch.length) responses.push(...await annotateBatch(batch));
    return { responses, redactionCounts: totalCounts, redactionRegions, redactedPages };
  }

  return { inspectAndRedact, annotateBatch, redactAndAnnotate };
}

export const GOOGLE_OCR_INFO_TYPES = Object.freeze([...DLP_REDACTION_INFO_TYPES]);
