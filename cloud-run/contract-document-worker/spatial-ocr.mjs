import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  GoogleOcrOperationalError,
  isDlpRequestBodyWithinLimit,
  MAX_DLP_IMAGE_BYTES,
} from "./google-secure-api.mjs";
import { resolveDocumentResourceLimits } from "./resource-limits.mjs";

const gzipAsync = promisify(gzip);
const MIN_NATIVE_CHARS = 160;
const MIN_NATIVE_WORDS = 24;
const MIN_NATIVE_CHARS_PER_SQUARE_INCH = 1.25;
const MIN_NATIVE_ALPHANUMERIC_RATIO = 0.65;
const MIN_NATIVE_WORDLIKE_RATIO = 0.7;
const FULL_PAGE_RASTER_COVERAGE = 0.72;
const DLP_RENDER_PROFILES = Object.freeze([
  { dpi: 300, quality: 95 },
  { dpi: 275, quality: 90 },
  { dpi: 250, quality: 88 },
  { dpi: 225, quality: 86 },
  { dpi: 200, quality: 85 },
]);
const MAX_RENDERED_PAGE_PIXELS = 40_000_000;

export async function readTextArtifactWithinLimit(path, maxBytes) {
  let handle;
  try {
    handle = await open(path, "r");
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile() || fileInfo.size > maxBytes) {
      throw new GoogleOcrOperationalError("document_text_limit_exceeded");
    }
    const bytes = Buffer.allocUnsafe(fileInfo.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytes } = await handle.read(overflowProbe, 0, 1, offset);
    if (overflowBytes > 0) throw new GoogleOcrOperationalError("document_text_limit_exceeded");
    if (offset !== bytes.length) throw new GoogleOcrOperationalError("document_text_limit_exceeded");
    return bytes.toString("utf8");
  } catch (error) {
    if (error instanceof GoogleOcrOperationalError) throw error;
    throw new GoogleOcrOperationalError("document_text_limit_exceeded", { cause: error });
  } finally {
    await handle?.close();
  }
}

export function enforceVisionWordLimits(pages, resourceLimits) {
  const limits = resolveDocumentResourceLimits(resourceLimits);
  let totalWords = 0;
  for (const page of pages) {
    const pageWords = Array.isArray(page?.words) ? page.words.length : 0;
    if (pageWords > limits.maxVisionWordsPerPage) {
      throw new GoogleOcrOperationalError("vision_word_limit_exceeded");
    }
    totalWords += pageWords;
    if (totalWords > limits.maxVisionWordsTotal) {
      throw new GoogleOcrOperationalError("vision_word_limit_exceeded");
    }
  }
  return totalWords;
}

function serializeSpatialGeometry(geometry, maxBytes) {
  const json = JSON.stringify(geometry);
  if (Buffer.byteLength(json) > maxBytes) {
    throw new GoogleOcrOperationalError("spatial_artifact_too_large");
  }
  return json;
}

export function parsePdfPageSize(value) {
  const match = value.match(/(?:Page\s+\d+\s+size|Page size):\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  if (!match) return null;
  const widthPoints = Number(match[1]);
  const heightPoints = Number(match[2]);
  if (!Number.isFinite(widthPoints) || !Number.isFinite(heightPoints)
    || widthPoints <= 0 || heightPoints <= 0) return null;
  return { widthPoints, heightPoints };
}

export function renderedPixelCount(pageSize, dpi) {
  if (!pageSize) return Number.POSITIVE_INFINITY;
  return Math.ceil(pageSize.widthPoints * dpi / 72)
    * Math.ceil(pageSize.heightPoints * dpi / 72);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function usefulText(text) {
  const compact = text.replace(/\s/g, "");
  const words = text.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const invalidRatio = compact.length ? (compact.match(/\uFFFD/g)?.length ?? 0) / compact.length : 0;
  const alphanumeric = compact.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const wordlike = words.filter((word) => (word.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2).length;
  return {
    chars: compact.length,
    words: words.length,
    invalidRatio,
    alphanumericRatio: compact.length ? alphanumeric / compact.length : 0,
    wordlikeRatio: words.length ? wordlike / words.length : 0,
  };
}

export function classifyPageText(text, {
  pageSize = { widthPoints: 612, heightPoints: 792 },
  imageEvidence = { fullPageRaster: false, coverage: 0 },
  rasterInspectionReliable = true,
} = {}) {
  const quality = usefulText(text);
  const areaSquareInches = pageSize?.widthPoints > 0 && pageSize?.heightPoints > 0
    ? pageSize.widthPoints * pageSize.heightPoints / (72 * 72)
    : 0;
  const density = areaSquareInches > 0 ? quality.chars / areaSquareInches : 0;
  const reliableNativeText = rasterInspectionReliable
    && !imageEvidence.fullPageRaster
    && quality.invalidRatio < 0.005
    && quality.alphanumericRatio >= MIN_NATIVE_ALPHANUMERIC_RATIO
    && quality.wordlikeRatio >= MIN_NATIVE_WORDLIKE_RATIO
    && quality.chars >= MIN_NATIVE_CHARS
    && quality.words >= MIN_NATIVE_WORDS
    && density >= MIN_NATIVE_CHARS_PER_SQUARE_INCH;
  if (reliableNativeText) {
    return { classification: "native_text", density, ...quality, ...imageEvidence };
  }
  return {
    classification: quality.chars > 0 ? "mixed" : "image_only",
    density,
    ...quality,
    ...imageEvidence,
  };
}

export function parsePdfImagesList(value) {
  const images = [];
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 14 || !/^\d+$/.test(fields[0])) continue;
    const [page, number, type, width, height] = fields;
    const xPpi = fields[12];
    const yPpi = fields[13];
    const parsed = {
      pageNumber: Number(page),
      imageNumber: Number(number),
      type,
      width: Number(width),
      height: Number(height),
      xPpi: Number(xPpi),
      yPpi: Number(yPpi),
    };
    if (parsed.pageNumber > 0 && parsed.width > 0 && parsed.height > 0) images.push(parsed);
  }
  return images;
}

export function isPdfImagesInventoryReliable(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  return /\bpage num type width height color comp bpc enc interp object id x-ppi y-ppi\b/.test(normalized);
}

export function pageRasterEvidence(images, pageSize) {
  const sourceImages = (images ?? []).filter((image) => image.type === "image");
  if (!pageSize || !sourceImages.length) {
    return { fullPageRaster: false, coverage: 0, imageCount: sourceImages.length };
  }
  const pageArea = pageSize.widthPoints * pageSize.heightPoints;
  let summedCoverage = 0;
  let largestCoverage = 0;
  for (const image of sourceImages) {
    let coverage = 0;
    if (image.xPpi >= 10 && image.yPpi >= 10) {
      const widthPoints = image.width / image.xPpi * 72;
      const heightPoints = image.height / image.yPpi * 72;
      coverage = widthPoints * heightPoints / pageArea;
    } else if (image.width * image.height >= 1_000_000) {
      const imageAspect = image.width / image.height;
      const pageAspect = pageSize.widthPoints / pageSize.heightPoints;
      if (Math.abs(Math.log(imageAspect / pageAspect)) <= 0.25) coverage = 1;
    }
    coverage = Math.max(0, Math.min(1, coverage));
    if (image.width * image.height >= 50_000) summedCoverage += coverage;
    largestCoverage = Math.max(largestCoverage, coverage);
  }
  const coverage = Math.min(1, Math.max(largestCoverage, summedCoverage));
  return {
    fullPageRaster: coverage >= FULL_PAGE_RASTER_COVERAGE,
    coverage,
    imageCount: sourceImages.length,
  };
}

function visionWordText(word) {
  return (word?.symbols ?? []).map((symbol) => symbol?.text ?? "").join("");
}

function safeVertices(word) {
  const vertices = word?.boundingBox?.vertices;
  if (!Array.isArray(vertices) || vertices.length !== 4) return null;
  const result = vertices.map((vertex) => ({ x: Number(vertex?.x ?? 0), y: Number(vertex?.y ?? 0) }));
  return result.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y)) ? result : null;
}

export function extractVisionPage(response, pageNumber) {
  if (response?.error?.message) throw new Error("vision_document_failed");
  const page = response?.fullTextAnnotation?.pages?.[0];
  if (!page || !Number.isFinite(Number(page.width)) || !Number.isFinite(Number(page.height))) {
    return { pageNumber, imageWidth: 0, imageHeight: 0, words: [] };
  }
  const words = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const word of paragraph.words ?? []) {
        const text = visionWordText(word).trim();
        const vertices = safeVertices(word);
        if (text && vertices) words.push({ text, confidence: Number(word.confidence ?? 0), vertices });
      }
    }
  }
  return {
    pageNumber,
    imageWidth: Number(page.width),
    imageHeight: Number(page.height),
    words,
  };
}

function normaliseDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function nearestQuadrant(value) {
  const angle = normaliseDegrees(value);
  const quadrant = (Math.round(angle / 90) * 90) % 360;
  const distance = Math.min(Math.abs(angle - quadrant), 360 - Math.abs(angle - quadrant));
  return { quadrant, distance };
}

/**
 * Infer physical raster orientation from Vision word baselines. PDF /Rotate
 * cannot describe pages that were scanned sideways before they became a PDF.
 * An ambiguous readable page is deliberately not guessed: callers must send it
 * to manual review instead of persisting geometry that does not match pixels.
 */
export function detectPhysicalOrientation(page) {
  const weights = new Map([[0, 0], [90, 0], [180, 0], [270, 0]]);
  let acceptedWords = 0;
  let totalWeight = 0;
  for (const word of page?.words ?? []) {
    const vertices = word?.vertices;
    if (!Array.isArray(vertices) || vertices.length !== 4) continue;
    const dx = Number(vertices[1]?.x) - Number(vertices[0]?.x);
    const dy = Number(vertices[1]?.y) - Number(vertices[0]?.y);
    const baseline = Math.hypot(dx, dy);
    if (!Number.isFinite(baseline) || baseline < 2) continue;
    const { quadrant, distance } = nearestQuadrant(Math.atan2(dy, dx) * 180 / Math.PI);
    if (distance > 28) continue;
    const confidence = Math.max(0.2, Math.min(1, Number(word.confidence) || 0));
    const weight = baseline * confidence;
    weights.set(quadrant, weights.get(quadrant) + weight);
    totalWeight += weight;
    acceptedWords += 1;
  }
  if (!acceptedWords || totalWeight <= 0) {
    return { reliable: false, detectedDegrees: 0, correctionDegrees: 0, confidence: 0, acceptedWords };
  }
  const [detectedDegrees, dominantWeight] = [...weights.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = dominantWeight / totalWeight;
  const minimumEvidence = acceptedWords >= 3
    || dominantWeight >= Math.max(Number(page?.imageWidth) || 0, Number(page?.imageHeight) || 0) * 0.08;
  const reliable = minimumEvidence && confidence >= 0.7;
  return {
    reliable,
    detectedDegrees,
    // Raster coordinates grow downwards on the y-axis. A downward (90°)
    // baseline is corrected by PIL's 90° counter-clockwise transpose, while an
    // upward (270°) baseline is corrected by its 270° transpose.
    correctionDegrees: reliable ? detectedDegrees : 0,
    confidence,
    acceptedWords,
  };
}

function transformPoint(point, correctionDegrees, sourceWidth, sourceHeight) {
  const x = Number(point.x);
  const y = Number(point.y);
  if (correctionDegrees === 90) return { x: y, y: sourceWidth - x };
  if (correctionDegrees === 180) return { x: sourceWidth - x, y: sourceHeight - y };
  if (correctionDegrees === 270) return { x: sourceHeight - y, y: x };
  return { x, y };
}

export function correctPageOrientation(page, correctionDegrees) {
  const correction = normaliseDegrees(correctionDegrees);
  if (![0, 90, 180, 270].includes(correction)) throw new Error("invalid_orientation_correction");
  const sourceWidth = Number(page.imageWidth);
  const sourceHeight = Number(page.imageHeight);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new Error("invalid_orientation_dimensions");
  return {
    ...page,
    sourceImageWidth: sourceWidth,
    sourceImageHeight: sourceHeight,
    imageWidth: correction % 180 === 0 ? sourceWidth : sourceHeight,
    imageHeight: correction % 180 === 0 ? sourceHeight : sourceWidth,
    orientationCorrection: correction,
    words: (page.words ?? []).map((word) => ({
      ...word,
      vertices: word.vertices.map((point) => transformPoint(point, correction, sourceWidth, sourceHeight)),
    })),
  };
}

function correctRedactionRegion(region, correctionDegrees, sourceWidth, sourceHeight) {
  const correction = normaliseDegrees(correctionDegrees);
  if (correction === 0) return { ...region };
  const corners = [
    { x: region.left, y: region.top },
    { x: region.left + region.width, y: region.top },
    { x: region.left + region.width, y: region.top + region.height },
    { x: region.left, y: region.top + region.height },
  ].map((point) => transformPoint(point, correction, sourceWidth, sourceHeight));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    ...region,
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function normaliseWord(value) {
  return value.normalize("NFKC").toLocaleLowerCase("da-DK").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function parsePdftotextBbox(html) {
  const pages = [];
  const pagePattern = /<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/gi;
  for (const pageMatch of html.matchAll(pagePattern)) {
    const words = [];
    const wordPattern = /<word\b[^>]*xMin="([\d.-]+)"[^>]*yMin="([\d.-]+)"[^>]*xMax="([\d.-]+)"[^>]*yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/gi;
    for (const match of pageMatch[3].matchAll(wordPattern)) {
      words.push({
        xMin: Number(match[1]), yMin: Number(match[2]), xMax: Number(match[3]), yMax: Number(match[4]),
        text: decodeXml(match[5].replace(/<[^>]+>/g, "")),
      });
    }
    pages.push({ width: Number(pageMatch[1]), height: Number(pageMatch[2]), words });
  }
  return pages;
}

function axisBox(vertices, scaleX, scaleY) {
  const xs = vertices.map((vertex) => vertex.x * scaleX);
  const ys = vertices.map((vertex) => vertex.y * scaleY);
  return { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) };
}

function intersectionOverUnion(a, b) {
  const width = Math.max(0, Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin));
  const height = Math.max(0, Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin));
  const intersection = width * height;
  const union = (a.xMax - a.xMin) * (a.yMax - a.yMin) + (b.xMax - b.xMin) * (b.yMax - b.yMin) - intersection;
  return union > 0 ? intersection / union : 0;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = ((a.y > point.y) !== (b.y > point.y))
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeSpatialAccuracy(geometryPages, extractedPages) {
  let expectedWords = 0;
  let matchedWords = 0;
  let passed = 0;
  let centerInside = 0;
  const ious = [];
  for (const geometry of geometryPages) {
    const actualPage = extractedPages[geometry.pageNumber - 1];
    const canMeasurePage = actualPage && geometry.imageWidth > 0 && geometry.imageHeight > 0;
    const scaleX = canMeasurePage ? actualPage.width / geometry.imageWidth : 0;
    const scaleY = canMeasurePage ? actualPage.height / geometry.imageHeight : 0;
    const unused = new Set(canMeasurePage ? actualPage.words.map((_, index) => index) : []);
    for (const expected of geometry.words) {
      const normalized = normaliseWord(expected.text);
      if (!normalized) continue;
      expectedWords += 1;
      if (!canMeasurePage) continue;
      const target = axisBox(expected.vertices, scaleX, scaleY);
      let best = null;
      for (const index of unused) {
        const candidate = actualPage.words[index];
        if (normaliseWord(candidate.text) !== normalized) continue;
        const iou = intersectionOverUnion(target, candidate);
        if (!best || iou > best.iou) best = { index, candidate, iou };
      }
      if (!best) continue;
      unused.delete(best.index);
      matchedWords += 1;
      ious.push(best.iou);
      const center = {
        x: (best.candidate.xMin + best.candidate.xMax) / 2,
        y: (best.candidate.yMin + best.candidate.yMax) / 2,
      };
      const polygon = expected.vertices.map((vertex) => ({ x: vertex.x * scaleX, y: vertex.y * scaleY }));
      const isInside = pointInPolygon(center, polygon);
      if (isInside) centerInside += 1;
      if (isInside && best.iou >= 0.75) passed += 1;
    }
  }
  const matchCoverage = expectedWords ? matchedWords / expectedWords : 0;
  // Missing words are failures, not absent measurements. This prevents a
  // derivative with a single correctly placed word and hundreds missing from
  // passing the spatial quality gate.
  const score = expectedWords ? passed / expectedWords : 0;
  const centerInsideRatio = matchedWords ? centerInside / matchedWords : 0;
  const medianIou = median(ious);
  return {
    expectedWords,
    matchedWords,
    measurableWords: matchedWords,
    matchCoverage,
    score,
    medianIou,
    centerInsideRatio,
    passed: expectedWords > 0
      && matchCoverage >= 0.95
      && score >= 0.95
      && medianIou >= 0.85
      && centerInsideRatio >= 0.98,
  };
}

export async function processPdfSpatially({
  inputPath,
  outputPath,
  geometryPath,
  workDir,
  commandRunner,
  googleClient,
  assertLeaseHealthy = () => {},
  resourceLimits,
  signal,
}) {
  const assertProcessingHealthy = () => {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("processing_aborted");
    assertLeaseHealthy();
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("processing_aborted");
  };
  const runCommand = async (command, args, timeoutMs) => {
    assertProcessingHealthy();
    const result = await commandRunner(command, args, timeoutMs, { signal });
    assertProcessingHealthy();
    return result;
  };
  const limits = resolveDocumentResourceLimits(resourceLimits);
  assertProcessingHealthy();
  const info = await runCommand("pdfinfo", [inputPath], 30_000);
  const pageCount = Number(info.stdout.match(/Pages:\s+(\d+)/i)?.[1] || 0);
  if (!pageCount) throw new Error("invalid_page_count");
  if (pageCount > limits.maxDocumentPages) {
    throw new GoogleOcrOperationalError("document_page_limit_exceeded");
  }

  let sourceImages = [];
  let rasterInspectionReliable = true;
  try {
    const listedImages = await runCommand("pdfimages", ["-list", inputPath], 60_000);
    const inventory = `${listedImages.stdout}\n${listedImages.stderr ?? ""}`;
    rasterInspectionReliable = !listedImages.stderr?.trim()
      && isPdfImagesInventoryReliable(inventory);
    sourceImages = rasterInspectionReliable ? parsePdfImagesList(inventory) : [];
  } catch {
    // Native-text classification must fail closed when the raster inventory is
    // unavailable. The page will be OCR-processed instead of being skipped.
    assertProcessingHealthy();
    rasterInspectionReliable = false;
  }

  const pageStates = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    assertProcessingHealthy();
    const pageInfo = await runCommand("pdfinfo", [
      "-f", String(pageNumber), "-l", String(pageNumber), "-box", inputPath,
    ], 30_000);
    const pageSize = parsePdfPageSize(pageInfo.stdout);
    if (!pageSize) throw new GoogleOcrOperationalError("page_geometry_unavailable");
    const textPath = join(workDir, `native-${pageNumber}.txt`);
    await runCommand("pdftotext", ["-f", String(pageNumber), "-l", String(pageNumber), inputPath, textPath], 60_000);
    const nativeText = await readTextArtifactWithinLimit(
      textPath,
      limits.maxNativeTextBytesPerPage,
    );
    const imageEvidence = pageRasterEvidence(
      sourceImages.filter((image) => image.pageNumber === pageNumber),
      pageSize,
    );
    const classification = classifyPageText(nativeText, {
      pageSize, imageEvidence, rasterInspectionReliable,
    });
    pageStates.push({ pageNumber, pageSize, ...classification });
  }

  // These counters describe mutually exclusive source-page classes. A mixed
  // document is deliberately sent through DLP/Vision for every page before
  // rebuilding the safe derivative, but a native source page must not then
  // count as both native and OCR-required in completion evidence.
  const nativePageCount = pageStates.filter((page) => page.classification === "native_text").length;
  const pagesNeedingOcr = pageStates.filter((page) => page.classification !== "native_text");
  if (pagesNeedingOcr.length === 0) {
    return {
      status: "not_required",
      classification: "native_text",
      pageCount,
      nativePageCount,
      ocrPageCount: 0,
      unreadablePageCount: 0,
      orientationCorrections: [],
      textCharCount: pageStates.reduce((total, page) => total + page.chars, 0),
    };
  }

  // A document that needs OCR is rebuilt consistently from DLP-redacted pages.
  // Processing every page prevents a mixed PDF from retaining unredacted native
  // pages next to redacted scan pages in the derivative.
  const pagesForOcr = [];
  let retainedRasterBytes = 0;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    assertProcessingHealthy();
    const prefix = join(workDir, `page-${pageNumber}`);
    const pageSize = pageStates[pageNumber - 1]?.pageSize;
    if (!pageSize) throw new GoogleOcrOperationalError("page_geometry_unavailable");
    let imageBytes = null;
    for (const profile of DLP_RENDER_PROFILES) {
      assertProcessingHealthy();
      if (renderedPixelCount(pageSize, profile.dpi) > MAX_RENDERED_PAGE_PIXELS) continue;
      await runCommand("pdftoppm", [
        "-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-cropbox",
        "-jpeg", "-jpegopt", `quality=${profile.quality}`, "-r", String(profile.dpi),
        "-gray", inputPath, prefix,
      ], 120_000);
      const candidatePath = `${prefix}.jpg`;
      const candidateInfo = await stat(candidatePath);
      if (candidateInfo.size > MAX_DLP_IMAGE_BYTES) continue;
      const candidate = await readFile(candidatePath);
      if (isDlpRequestBodyWithinLimit(candidate)) {
        imageBytes = candidate;
        break;
      }
    }
    if (!imageBytes) throw new GoogleOcrOperationalError("dlp_request_too_large");
    retainedRasterBytes += imageBytes.length;
    if (retainedRasterBytes > limits.maxDocumentRasterBytes) {
      throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
    }
    pagesForOcr.push({ pageNumber, imageBytes });
  }

  assertProcessingHealthy();
  const { responses, redactionCounts, redactionRegions, redactedPages } = await googleClient.redactAndAnnotate(
    pagesForOcr,
    { assertHealthy: assertProcessingHealthy, resourceLimits: limits, signal },
  );
  assertProcessingHealthy();
  const rawGeometryPages = responses.map((response, index) => extractVisionPage(response, pagesForOcr[index].pageNumber));
  enforceVisionWordLimits(rawGeometryPages, limits);
  const orientationByPage = new Map(rawGeometryPages.map((page) => [
    page.pageNumber, detectPhysicalOrientation(page),
  ]));
  const orientationCorrections = rawGeometryPages
    .map((page) => ({ page: page.pageNumber, degrees: orientationByPage.get(page.pageNumber).correctionDegrees }))
    .filter((entry) => entry.degrees !== 0);
  const orientationUncertainPageCount = rawGeometryPages.filter((page) => (
    page.words.length > 0 && !orientationByPage.get(page.pageNumber).reliable
  )).length;
  const unreadablePageCount = rawGeometryPages.filter((page) => page.words.length === 0).length;
  if (unreadablePageCount > 0) {
    return {
      status: "needs_review", classification: "unreadable", pageCount,
      nativePageCount,
      ocrPageCount: pageCount - nativePageCount,
      unreadablePageCount, redactionCounts,
      orientationCorrections,
      orientationUncertainPageCount,
      redactionProfile: "dfks-contract-redaction-v1",
      spatialSchemaVersion: "google-vision-spatial-v2",
    };
  }
  if (orientationUncertainPageCount > 0) {
    return {
      status: "needs_review", classification: "orientation_uncertain", pageCount,
      nativePageCount,
      ocrPageCount: pageCount - nativePageCount,
      unreadablePageCount,
      redactionCounts,
      orientationCorrections,
      orientationUncertainPageCount,
      orientationQualityFailed: true,
      redactionProfile: "dfks-contract-redaction-v1",
      spatialSchemaVersion: "google-vision-spatial-v2",
    };
  }

  const geometryPages = rawGeometryPages.map((page) => {
    const orientation = orientationByPage.get(page.pageNumber);
    return correctPageOrientation(page, orientation.correctionDegrees);
  });
  const correctedRedactionRegions = (redactionRegions ?? []).map((region) => {
    const page = rawGeometryPages.find((candidate) => candidate.pageNumber === region.pageNumber);
    const orientation = orientationByPage.get(region.pageNumber);
    if (!page || !orientation?.reliable) return { ...region };
    return correctRedactionRegion(
      region, orientation.correctionDegrees, page.imageWidth, page.imageHeight,
    );
  });

  const geometry = {
    schemaVersion: "google-vision-spatial-v2",
    engine: "google-vision-document-text-detection",
    redactionEngine: "google-sensitive-data-protection-image-redact",
    redactionProfile: "dfks-contract-redaction-v1",
    redactions: correctedRedactionRegions,
    pages: geometryPages,
  };
  const plainGeometryPath = join(workDir, "vision-geometry.json");
  await writeFile(
    plainGeometryPath,
    serializeSpatialGeometry(geometry, limits.maxSpatialJsonBytes),
    { mode: 0o600 },
  );
  assertProcessingHealthy();
  for (const page of redactedPages) {
    const sourcePath = join(workDir, `redacted-source-${page.pageNumber}.jpg`);
    const outputImagePath = join(workDir, `redacted-${page.pageNumber}.png`);
    const orientation = orientationByPage.get(page.pageNumber);
    await writeFile(sourcePath, page.imageBytes, { mode: 0o600 });
    await runCommand("python3", [
      join(process.cwd(), "normalise_orientation.py"),
      sourcePath,
      outputImagePath,
      String(orientation?.correctionDegrees ?? 0),
    ], 60_000);
    assertProcessingHealthy();
  }
  await runCommand("python3", [
    join(process.cwd(), "vision_overlay.py"), inputPath, plainGeometryPath, workDir, outputPath,
  ], 180_000);

  const bboxPath = join(workDir, "output-bbox.html");
  await runCommand("pdftotext", ["-cropbox", "-bbox-layout", outputPath, bboxPath], 120_000);
  const extractedPages = parsePdftotextBbox(await readTextArtifactWithinLimit(
    bboxPath,
    limits.maxPdfBboxBytes,
  ));
  assertProcessingHealthy();
  const spatial = computeSpatialAccuracy(geometryPages, extractedPages);
  const finalTextPath = join(workDir, "output-text.txt");
  await runCommand("pdftotext", [outputPath, finalTextPath], 120_000);
  const finalText = await readTextArtifactWithinLimit(finalTextPath, limits.maxPdfTextBytes);
  assertProcessingHealthy();
  const textCharCount = finalText.replace(/\s/g, "").length;
  // Persist the independently measured metrics only after the derivative has
  // been rebuilt and verified. The uploaded artefact therefore cannot claim
  // spatial success based solely on Vision's source geometry.
  const verifiedGeometry = { ...geometry, spatialVerification: spatial };
  const verifiedGeometryJson = serializeSpatialGeometry(
    verifiedGeometry,
    limits.maxSpatialJsonBytes,
  );
  const compressedGeometry = await gzipAsync(Buffer.from(verifiedGeometryJson));
  if (compressedGeometry.length > limits.maxSpatialGzipBytes) {
    throw new GoogleOcrOperationalError("spatial_artifact_too_large");
  }
  await writeFile(
    geometryPath,
    compressedGeometry,
    { mode: 0o600 },
  );
  assertProcessingHealthy();
  const classification = nativePageCount === 0 && pageStates.every((page) => page.classification === "image_only")
    ? "image_only" : "mixed";
  return {
    status: spatial.passed && textCharCount >= 120 ? "completed" : "needs_review",
    classification,
    pageCount,
    nativePageCount,
    ocrPageCount: pageCount - nativePageCount,
    unreadablePageCount,
    orientationCorrections,
    orientationUncertainPageCount,
    redactionCounts,
    redactionProfile: "dfks-contract-redaction-v1",
    spatialSchemaVersion: "google-vision-spatial-v2",
    spatial,
    textCharCount,
  };
}
