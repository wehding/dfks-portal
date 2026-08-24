import https from "node:https";

const VISION_HOST = "eu-vision.googleapis.com";
const DLP_HOST = "dlp.eu.rep.googleapis.com";
const MAX_VISION_IMAGES = 16;
const MAX_VISION_BODY_BYTES = 8 * 1024 * 1024;
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
  if (!projectId || visionLocation !== "eu" || dlpLocation !== "eu") {
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

export async function secureJsonPost(urlValue, token, payload, { requestImpl = https.request } = {}) {
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

function findingCounts(response) {
  const counts = {};
  for (const finding of response?.result?.findings ?? []) {
    const name = finding?.infoType?.name;
    if (DLP_INFO_TYPES.includes(name)) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

export function createGoogleOcrClient({
  config = readGoogleConfig(),
  accessTokenProvider = fetchGoogleAccessToken,
  jsonPost = secureJsonPost,
} = {}) {
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
    const inspect = await jsonPost(
      `${config.dlpEndpoint}/v2/${parent}/content:inspect`,
      token,
      { parent, inspectConfig, item: { byteItem } },
    );
    const counts = findingCounts(inspect);
    if (Object.keys(counts).length === 0) return { imageBytes, counts };

    const redacted = await jsonPost(
      `${config.dlpEndpoint}/v2/${parent}/image:redact`,
      token,
      {
        parent,
        inspectConfig,
        imageRedactionConfigs: DLP_INFO_TYPES.map((name) => ({ infoType: { name } })),
        byteItem,
      },
    );
    if (typeof redacted.redactedImage !== "string" || !redacted.redactedImage) {
      throw new GoogleOcrOperationalError("dlp_redaction_failed");
    }
    return { imageBytes: Buffer.from(redacted.redactedImage, "base64"), counts };
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
    const result = await jsonPost(
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
