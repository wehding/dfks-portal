import https from "node:https";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const VISION_HOST = "eu-vision.googleapis.com";
const DLP_HOST = "dlp.eu.rep.googleapis.com";
const MAX_VISION_IMAGES = 16;
const MAX_VISION_BODY_BYTES = 8 * 1024 * 1024;
const MAX_DLP_BOXES_PER_PAGE = 2_000;
const LOCAL_MASK_SCRIPT = fileURLToPath(new URL("./mask_sensitive_image.py", import.meta.url));
const DLP_INFO_TYPES = [
  "DENMARK_CPR_NUMBER",
  "FINANCIAL_ACCOUNT_NUMBER",
  "IBAN_CODE",
  "CREDIT_CARD_NUMBER",
  "CREDIT_CARD_TRACK_NUMBER",
  "CVV_NUMBER",
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
  for (const finding of response?.result?.findings ?? []) {
    const name = finding?.infoType?.name;
    if (!DLP_INFO_TYPES.includes(name)) continue;
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
          boxes.push(parsed);
        }
      }
    }
  }
  if (boxes.length > MAX_DLP_BOXES_PER_PAGE) {
    throw new GoogleOcrOperationalError("dlp_too_many_locations");
  }
  return { counts, boxes };
}

export async function maskSensitiveImageBytes(imageBytes, boxes, {
  spawnImpl = spawn,
  scriptPath = LOCAL_MASK_SCRIPT,
} = {}) {
  if (!boxes.length) return imageBytes;
  return new Promise((resolve, reject) => {
    const child = spawnImpl("python3", [scriptPath, JSON.stringify(boxes)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = [];
    let outputBytes = 0;
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 16 * 1024 * 1024) {
        child.kill("SIGKILL");
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-1_000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new GoogleOcrOperationalError("local_redaction_failed", { cause: error }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || outputBytes === 0 || outputBytes > 16 * 1024 * 1024) {
        reject(new GoogleOcrOperationalError("local_redaction_failed", {
          cause: stderr ? new Error("redaction_process_failed") : undefined,
        }));
        return;
      }
      resolve(Buffer.concat(output, outputBytes));
    });
    child.stdin.once("error", () => {});
    child.stdin.end(imageBytes);
  });
}

export function createGoogleOcrClient({
  config = readGoogleConfig(),
  accessTokenProvider = fetchGoogleAccessToken,
  jsonPost = secureJsonPost,
  imageMasker = maskSensitiveImageBytes,
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
      minLikelihood: "POSSIBLE",
      includeQuote: false,
      limits: { maxFindingsPerRequest: 500 },
    };
    const parent = `projects/${config.projectId}/locations/${config.dlpLocation}`;
    const inspect = await post(
      `${config.dlpEndpoint}/v2/${parent}/content:inspect`,
      token,
      { parent, inspectConfig, item: { byteItem } },
    );
    const { counts, boxes } = extractDlpFindings(inspect);
    if (Object.keys(counts).length > 0 && boxes.length === 0) {
      // Fail closed rather than sending a known sensitive, unmasked page to Vision.
      throw new GoogleOcrOperationalError("dlp_location_missing");
    }
    return { imageBytes: await imageMasker(imageBytes, boxes), counts };
  }

  async function annotateBatch(pages) {
    const token = await accessTokenProvider();
    const parent = `projects/${config.projectId}/locations/${config.visionLocation}`;
    const payload = {
      parent,
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
    for (const page of pages) {
      // Fail closed: a DLP error prevents the page from reaching Vision.
      const redacted = await inspectAndRedact(page.imageBytes);
      for (const [name, count] of Object.entries(redacted.counts)) {
        totalCounts[name] = (totalCounts[name] ?? 0) + count;
      }
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
    return { responses, redactionCounts: totalCounts };
  }

  return { inspectAndRedact, annotateBatch, redactAndAnnotate };
}

export const GOOGLE_OCR_INFO_TYPES = Object.freeze([...DLP_INFO_TYPES]);
