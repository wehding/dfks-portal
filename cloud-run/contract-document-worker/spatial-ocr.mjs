import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import {
  GoogleOcrOperationalError,
  MAX_VISION_IMAGE_BYTES,
} from "./google-vision-api.mjs";
import { resolveDocumentResourceLimits } from "./resource-limits.mjs";
import {
  hasSparseTailBlankConsensus,
  recoverSparseTailOrientationFromVariants,
  recoverSparseTailTextFromVariants,
} from "./tail-page-recovery.mjs";

const gzipAsync = promisify(gzip);
const MIN_NATIVE_CHARS = 160;
const MIN_NATIVE_WORDS = 24;
const MIN_NATIVE_CHARS_PER_SQUARE_INCH = 1.25;
const MIN_NATIVE_ALPHANUMERIC_RATIO = 0.65;
const MIN_NATIVE_WORDLIKE_RATIO = 0.7;
const MIN_SPARSE_NATIVE_CHARS = 48;
const MIN_SPARSE_NATIVE_WORDS = 8;
const MIN_SPARSE_NATIVE_CHARS_PER_SQUARE_INCH = 0.35;
const MIN_SPARSE_NATIVE_ALPHANUMERIC_RATIO = 0.75;
const MIN_SPARSE_NATIVE_WORDLIKE_RATIO = 0.8;
const FULL_PAGE_RASTER_COVERAGE = 0.72;
const MIN_RASTER_TILE_PIXELS = 64 * 64;
// A page is exempted from the unreadable-page gate only when it is almost
// completely white and contains no extracted or OCR text.
// The limits deliberately reject sparse signatures, initials and faint text.
const MAX_BLANK_NON_WHITE_RATIO = 0.003;
const MAX_BLANK_DARK_RATIO = 0.0015;
const MIN_BLANK_MEAN = 252;
const MAX_BLANK_STDEV = 12;
const MAX_BLANK_LOCAL_NON_WHITE_RATIO = 0.04;
const MAX_BLANK_LOCAL_DARK_RATIO = 0.01;
const BLANK_INSPECTION_BLOCK_SIZE = 64;
const MAX_EXACT_ASSIGNMENT_WORDS_PER_GROUP = 128;
// Hungarian matching is cubic in the repeated-word group size. Bound both a
// single group and the accumulated work per page so a hostile text layer with
// many repeated tokens cannot monopolise the worker. The deterministic
// reading-order fallback preserves fail-closed spatial verification.
const MAX_EXACT_ASSIGNMENT_WORK_PER_PAGE = 2_000_000;
// Poppler may emit a compound word as several short PDF tokens (and Vision can
// do the inverse). Keep the reconciliation bounded, require exact normalised
// text and only combine geometrically adjacent tokens on the same line. The
// unchanged centre/IoU gates below still decide whether the union is valid.
const MAX_JOINED_TOKENS = 8;
const MAX_JOINED_TOKEN_CHARS = 96;
const MIN_JOINED_TOKEN_VERTICAL_OVERLAP_RATIO = 0.5;
const MAX_JOINED_TOKEN_GAP_HEIGHT_RATIO = 1.5;
const MAX_UNREADABLE_RECOVERY_PAGES = 4;
const MAX_ORIENTATION_RECOVERY_PAGES = 4;
const MIN_ORIENTATION_RECOVERY_VARIANTS = 2;
const MIN_UNREADABLE_RECOVERY_WORDS = 3;
const MIN_UNREADABLE_RECOVERY_CHARS = 12;
const MIN_UNREADABLE_RECOVERY_CONFIDENCE = 0.75;
const MIN_UNREADABLE_RECOVERY_WORD_IOU = 0.65;
const MIN_UNREADABLE_RECOVERY_MEDIAN_IOU = 0.85;
const MAX_UNREADABLE_RECOVERY_CENTER_DISTANCE_RATIO = 0.01;
const VISION_RENDER_PROFILES = Object.freeze([
  { dpi: 300, quality: 95 },
  { dpi: 275, quality: 90 },
  { dpi: 250, quality: 88 },
  { dpi: 225, quality: 86 },
  { dpi: 200, quality: 85 },
]);
const MAX_RENDERED_PAGE_PIXELS = 40_000_000;
const MIN_SPATIAL_TEXT_CHARS = 120;
const SPATIAL_OVERLAY_FALLBACK_PROFILES = Object.freeze([
  "font-metrics-v1",
  "axis-aligned-font-metrics-v1",
]);

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
  const reliableSparseNativeText = rasterInspectionReliable
    && !imageEvidence.fullPageRaster
    && Number(imageEvidence.coverage || 0) < 0.15
    && quality.invalidRatio < 0.005
    && quality.alphanumericRatio >= MIN_SPARSE_NATIVE_ALPHANUMERIC_RATIO
    && quality.wordlikeRatio >= MIN_SPARSE_NATIVE_WORDLIKE_RATIO
    && quality.chars >= MIN_SPARSE_NATIVE_CHARS
    && quality.words >= MIN_SPARSE_NATIVE_WORDS
    && density >= MIN_SPARSE_NATIVE_CHARS_PER_SQUARE_INCH;
  if (reliableNativeText || reliableSparseNativeText) {
    return {
      classification: "native_text",
      nativeTextConfidence: reliableNativeText ? "standard" : "sparse",
      density,
      ...quality,
      ...imageEvidence,
    };
  }
  return {
    classification: quality.chars > 0 ? "mixed" : "image_only",
    density,
    ...quality,
    ...imageEvidence,
  };
}

export function classifyRasterBlankness({
  histogram,
  mean,
  stdev,
  maxLocalNonWhiteRatio = 0,
  maxLocalDarkRatio = 0,
}) {
  if (!Array.isArray(histogram) || histogram.length !== 256) {
    return { blank: false, nonWhiteRatio: 1, darkRatio: 1 };
  }
  const pixels = histogram.reduce((total, count) => total + Number(count || 0), 0);
  if (!(pixels > 0) || !Number.isFinite(mean) || !Number.isFinite(stdev)) {
    return { blank: false, nonWhiteRatio: 1, darkRatio: 1 };
  }
  const nonWhite = histogram.slice(0, 245).reduce((total, count) => total + Number(count || 0), 0);
  const dark = histogram.slice(0, 200).reduce((total, count) => total + Number(count || 0), 0);
  const nonWhiteRatio = nonWhite / pixels;
  const darkRatio = dark / pixels;
  return {
    blank: nonWhiteRatio <= MAX_BLANK_NON_WHITE_RATIO
      && darkRatio <= MAX_BLANK_DARK_RATIO
      && mean >= MIN_BLANK_MEAN
      && stdev <= MAX_BLANK_STDEV
      && maxLocalNonWhiteRatio <= MAX_BLANK_LOCAL_NON_WHITE_RATIO
      && maxLocalDarkRatio <= MAX_BLANK_LOCAL_DARK_RATIO,
    nonWhiteRatio,
    darkRatio,
  };
}

async function inspectRasterBlankness(imageBytes) {
  try {
    const { data, info } = await sharp(imageBytes, {
      failOn: "warning",
      limitInputPixels: MAX_RENDERED_PAGE_PIXELS,
      sequentialRead: true,
    }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const histogram = Array(256).fill(0);
    const blockColumns = Math.ceil(info.width / BLANK_INSPECTION_BLOCK_SIZE);
    const blockRows = Math.ceil(info.height / BLANK_INSPECTION_BLOCK_SIZE);
    const localNonWhite = new Uint32Array(blockColumns * blockRows);
    const localDark = new Uint32Array(blockColumns * blockRows);
    let sum = 0;
    let squaresSum = 0;
    for (let offset = 0; offset < data.length; offset += 1) {
      const value = data[offset];
      histogram[value] += 1;
      sum += value;
      squaresSum += value * value;
      if (value < 245) {
        const x = offset % info.width;
        const y = Math.floor(offset / info.width);
        const block = Math.floor(y / BLANK_INSPECTION_BLOCK_SIZE) * blockColumns
          + Math.floor(x / BLANK_INSPECTION_BLOCK_SIZE);
        localNonWhite[block] += 1;
        if (value < 200) localDark[block] += 1;
      }
    }
    const mean = data.length ? sum / data.length : Number.NaN;
    const variance = data.length ? Math.max(0, squaresSum / data.length - mean * mean) : Number.NaN;
    let maxLocalNonWhiteRatio = 0;
    let maxLocalDarkRatio = 0;
    for (let blockY = 0; blockY < blockRows; blockY += 1) {
      for (let blockX = 0; blockX < blockColumns; blockX += 1) {
        const block = blockY * blockColumns + blockX;
        const blockWidth = Math.min(BLANK_INSPECTION_BLOCK_SIZE,
          info.width - blockX * BLANK_INSPECTION_BLOCK_SIZE);
        const blockHeight = Math.min(BLANK_INSPECTION_BLOCK_SIZE,
          info.height - blockY * BLANK_INSPECTION_BLOCK_SIZE);
        const blockPixels = blockWidth * blockHeight;
        maxLocalNonWhiteRatio = Math.max(maxLocalNonWhiteRatio, localNonWhite[block] / blockPixels);
        maxLocalDarkRatio = Math.max(maxLocalDarkRatio, localDark[block] / blockPixels);
      }
    }
    const classification = classifyRasterBlankness({
      histogram,
      mean,
      stdev: Math.sqrt(variance),
      maxLocalNonWhiteRatio,
      maxLocalDarkRatio,
    });
    return {
      ...classification,
      width: Number(info.width || 0),
      height: Number(info.height || 0),
      mean,
      stdev: Math.sqrt(variance),
      maxLocalNonWhiteRatio,
      maxLocalDarkRatio,
    };
  } catch {
    // A decode/statistics error can never turn a page into a trusted blank.
    return {
      blank: false,
      nonWhiteRatio: 1,
      darkRatio: 1,
      width: 0,
      height: 0,
      mean: 0,
      stdev: Number.POSITIVE_INFINITY,
      maxLocalNonWhiteRatio: 1,
      maxLocalDarkRatio: 1,
    };
  }
}

export function classifyOcrDocument(pageStates) {
  return pageStates.every((page) => page.classification === "image_only")
    ? "image_only"
    : "mixed";
}

export function completionPageCounts(pageStates, forceOcr = false) {
  const sourceNativePageCount = pageStates
    .filter((page) => page.classification === "native_text").length;
  // Forced Vision rebuilds every source page from a Vision response. This is
  // also true for mixed PDFs, so completion evidence must count every page as
  // OCR-processed rather than retaining the source document's classification.
  if (forceOcr) {
    return { nativePageCount: 0, ocrPageCount: pageStates.length };
  }
  return {
    nativePageCount: sourceNativePageCount,
    ocrPageCount: pageStates.length - sourceNativePageCount,
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
    // Scanners may encode one page as many small image tiles. Ignoring every
    // tile below 50k pixels can make a scanned page with a hidden OCR layer
    // look native and bypass Vision. The bounded pdfimages inventory keeps
    // this aggregation finite; over-counting overlapping tiles fails safely
    // toward OCR rather than skipping it.
    if (image.width * image.height >= MIN_RASTER_TILE_PIXELS) {
      summedCoverage += coverage;
    }
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

export function mapVisionPageToCanonical(page, transform) {
  const sourceWidth = Number(transform?.sourceWidth);
  const sourceHeight = Number(transform?.sourceHeight);
  const visionWidth = Number(transform?.visionWidth);
  const visionHeight = Number(transform?.visionHeight);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)
    || !(visionWidth > 0) || !(visionHeight > 0)
    || transform?.pageNumber !== page?.pageNumber) {
    throw new Error("invalid_vision_page_transform");
  }
  if ((page.imageWidth > 0 && Math.abs(page.imageWidth - visionWidth) > 1)
    || (page.imageHeight > 0 && Math.abs(page.imageHeight - visionHeight) > 1)) {
    throw new Error("vision_page_dimension_mismatch");
  }
  const scaleX = sourceWidth / visionWidth;
  const scaleY = sourceHeight / visionHeight;
  return {
    ...page,
    imageWidth: sourceWidth,
    imageHeight: sourceHeight,
    words: (page.words ?? []).map((word) => ({
      ...word,
      vertices: word.vertices.map((vertex) => ({
        x: vertex.x * scaleX,
        y: vertex.y * scaleY,
      })),
    })),
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

/**
 * Resolve every page exclusively from its own Vision geometry. Neighboring
 * pages are intentionally not allowed to promote an ambiguous page: the
 * established >= 0.70 confidence and local evidence gate remains unchanged.
 */
export function resolvePhysicalOrientations(pages) {
  return new Map((pages ?? []).map((page) => [
    page.pageNumber,
    detectPhysicalOrientation(page),
  ]));
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

/**
 * Persist only the documented v3 page schema. Recovery profiles, retry
 * rotations and other in-memory decision evidence must never leak into the
 * long-lived geometry artifact.
 */
export function canonicaliseSpatialGeometryPage(page, correctionDegrees) {
  const corrected = correctPageOrientation(page, correctionDegrees);
  return {
    pageNumber: corrected.pageNumber,
    sourceImageWidth: corrected.sourceImageWidth,
    sourceImageHeight: corrected.sourceImageHeight,
    imageWidth: corrected.imageWidth,
    imageHeight: corrected.imageHeight,
    orientationCorrection: corrected.orientationCorrection,
    words: corrected.words.map((word) => ({
      text: String(word.text ?? ""),
      confidence: Number(word.confidence) || 0,
      vertices: word.vertices.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
      })),
    })),
  };
}

/**
 * Undo the deterministic clockwise raster rotation used by the Vision retry.
 * The returned word polygons are expressed in the original, canonical source
 * raster. A retry transform is correlation metadata, never authorization.
 */
export function mapOrientationVariantToCanonical(page, transform) {
  const rotationDegrees = normaliseDegrees(Number(transform?.rotationDegrees));
  const canonicalWidth = Number(transform?.canonicalWidth);
  const canonicalHeight = Number(transform?.canonicalHeight);
  if (!Number.isSafeInteger(Number(transform?.rotationDegrees))
    || ![0, 90, 180, 270].includes(rotationDegrees)
    || !(canonicalWidth > 0) || !(canonicalHeight > 0)
    || transform?.pageNumber !== page?.pageNumber) {
    throw new Error("invalid_orientation_variant_transform");
  }
  const corrected = correctPageOrientation(page, rotationDegrees);
  if (Math.abs(corrected.imageWidth - canonicalWidth) > 1
    || Math.abs(corrected.imageHeight - canonicalHeight) > 1) {
    throw new Error("orientation_variant_dimension_mismatch");
  }
  return {
    pageNumber: page.pageNumber,
    imageWidth: canonicalWidth,
    imageHeight: canonicalHeight,
    words: corrected.words,
    recoveryRotationDegrees: rotationDegrees,
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

function pointOnSegment(point, start, end, epsilon = 1e-6) {
  const cross = (point.y - start.y) * (end.x - start.x)
    - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > epsilon) return false;
  return point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
}

function pointInPolygonInclusive(point, polygon) {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  return pointInPolygon(point, polygon);
}

function pointInAxisBoxInclusive(point, box) {
  return point.x >= box.xMin && point.x <= box.xMax
    && point.y >= box.yMin && point.y <= box.yMax;
}

function boxCenter(box) {
  return { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
}

function polygonCenter(polygon) {
  return polygon.reduce((center, point) => ({
    x: center.x + point.x / polygon.length,
    y: center.y + point.y / polygon.length,
  }), { x: 0, y: 0 });
}

/**
 * Accept an unreadable-page retry only when the colour and contrast/grayscale
 * Vision responses independently produce the same normalized token stream and
 * tightly overlapping geometry. The colour response is retained unchanged;
 * agreement is a safety gate, not a geometry-merging heuristic.
 */
export function recoverUnreadablePageFromVariants(variantPages) {
  if (!Array.isArray(variantPages) || variantPages.length !== 2) return null;
  const [colour, contrastGray] = variantPages;
  if (colour?.pageNumber !== contrastGray?.pageNumber
    || !(colour?.imageWidth > 0) || !(colour?.imageHeight > 0)
    || Math.abs(colour.imageWidth - contrastGray.imageWidth) > 1
    || Math.abs(colour.imageHeight - contrastGray.imageHeight) > 1) return null;
  const colourWords = Array.isArray(colour.words) ? colour.words : [];
  const grayWords = Array.isArray(contrastGray.words) ? contrastGray.words : [];
  if (colourWords.length < MIN_UNREADABLE_RECOVERY_WORDS
    || colourWords.length !== grayWords.length) return null;
  const colourTokens = colourWords.map((word) => normaliseWord(String(word.text ?? "")));
  const grayTokens = grayWords.map((word) => normaliseWord(String(word.text ?? "")));
  if (colourTokens.some((token) => !token)
    || colourTokens.join("\u001f") !== grayTokens.join("\u001f")
    || colourTokens.reduce((total, token) => total + token.length, 0) < MIN_UNREADABLE_RECOVERY_CHARS) {
    return null;
  }
  const colourConfidence = median(colourWords.map((word) => Number(word.confidence) || 0));
  const grayConfidence = median(grayWords.map((word) => Number(word.confidence) || 0));
  if (colourConfidence < MIN_UNREADABLE_RECOVERY_CONFIDENCE
    || grayConfidence < MIN_UNREADABLE_RECOVERY_CONFIDENCE) return null;

  const pageDiagonal = Math.hypot(colour.imageWidth, colour.imageHeight);
  const maximumCenterDistance = Math.max(2,
    pageDiagonal * MAX_UNREADABLE_RECOVERY_CENTER_DISTANCE_RATIO);
  const overlaps = [];
  for (let index = 0; index < colourWords.length; index += 1) {
    const colourVertices = colourWords[index]?.vertices;
    const grayVertices = grayWords[index]?.vertices;
    if (!Array.isArray(colourVertices) || colourVertices.length !== 4
      || !Array.isArray(grayVertices) || grayVertices.length !== 4) return null;
    const colourBox = axisBox(colourVertices, 1, 1);
    const grayBox = axisBox(grayVertices, 1, 1);
    const overlap = intersectionOverUnion(colourBox, grayBox);
    const colourCenter = boxCenter(colourBox);
    const grayCenter = boxCenter(grayBox);
    const centerDistance = Math.hypot(
      colourCenter.x - grayCenter.x,
      colourCenter.y - grayCenter.y,
    );
    if (overlap < MIN_UNREADABLE_RECOVERY_WORD_IOU
      || centerDistance > maximumCenterDistance) return null;
    overlaps.push(overlap);
  }
  if (median(overlaps) < MIN_UNREADABLE_RECOVERY_MEDIAN_IOU) return null;
  return {
    ...colour,
    recoveryProfile: "vision-colour-contrast-consensus-v1",
  };
}

// Minimum-cost rectangular assignment (Hungarian algorithm). Matching all
// equal words on the page as one group avoids the old greedy cascade where an
// early occurrence of "i", "og" or another repeated word consumed the box
// belonging to a later occurrence. Text equality is still exact after the
// established normalisation; geometry only decides which equal occurrence is
// paired with which box.
function minimumCostAssignment(costs) {
  const rowCount = costs.length;
  const columnCount = costs[0]?.length ?? 0;
  if (!rowCount || rowCount > columnCount) return [];
  const u = Array(rowCount + 1).fill(0);
  const v = Array(columnCount + 1).fill(0);
  const p = Array(columnCount + 1).fill(0);
  const way = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minValue = Array(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const current = costs[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minValue[column]) {
          minValue[column] = current;
          way[column] = column0;
        }
        if (minValue[column] < delta) {
          delta = minValue[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minValue[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const pairs = [];
  for (let column = 1; column <= columnCount; column += 1) {
    if (p[column] > 0) pairs.push([p[column] - 1, column - 1]);
  }
  return pairs;
}

function assignEqualWords(expected, actual, pageDiagonal, exactAssignmentBudget) {
  if (!expected.length || !actual.length) return [];
  const rowCount = Math.min(expected.length, actual.length);
  const columnCount = Math.max(expected.length, actual.length);
  const estimatedWork = rowCount * rowCount * columnCount;
  const useReadingOrder = Math.max(expected.length, actual.length)
      > MAX_EXACT_ASSIGNMENT_WORDS_PER_GROUP
    || estimatedWork > exactAssignmentBudget.remaining;
  if (useReadingOrder) {
    const readingOrder = (item) => {
      const center = boxCenter(item.target ?? item.box);
      return center.y * Math.max(pageDiagonal, 1) + center.x;
    };
    const orderedExpected = [...expected].sort((a, b) => readingOrder(a) - readingOrder(b));
    const orderedActual = [...actual].sort((a, b) => readingOrder(a) - readingOrder(b));
    return orderedExpected
      .slice(0, Math.min(orderedExpected.length, orderedActual.length))
      .map((expectedWord, index) => ({ expected: expectedWord, actual: orderedActual[index] }));
  }
  exactAssignmentBudget.remaining -= estimatedWork;
  const expectedIsRows = expected.length <= actual.length;
  const rows = expectedIsRows ? expected : actual;
  const columns = expectedIsRows ? actual : expected;
  const costs = rows.map((row) => columns.map((column) => {
    const expectedWord = expectedIsRows ? row : column;
    const actualWord = expectedIsRows ? column : row;
    const iou = intersectionOverUnion(expectedWord.target, actualWord.box);
    const firstCenter = boxCenter(expectedWord.target);
    const secondCenter = boxCenter(actualWord.box);
    const centreDistance = Math.hypot(
      firstCenter.x - secondCenter.x,
      firstCenter.y - secondCenter.y,
    ) / Math.max(pageDiagonal, 1);
    // IoU is the primary evidence. Distance only breaks near ties and makes
    // zero-overlap duplicates deterministic without turning them into a pass.
    return 1 - iou + Math.min(centreDistance, 1) * 0.01;
  }));
  return minimumCostAssignment(costs).map(([row, column]) => (
    expectedIsRows
      ? { expected: rows[row], actual: columns[column] }
      : { expected: columns[column], actual: rows[row] }
  ));
}

function unionAxisBoxes(boxes) {
  return {
    xMin: Math.min(...boxes.map((box) => box.xMin)),
    yMin: Math.min(...boxes.map((box) => box.yMin)),
    xMax: Math.max(...boxes.map((box) => box.xMax)),
    yMax: Math.max(...boxes.map((box) => box.yMax)),
  };
}

function verticallyOverlap(first, second) {
  const overlap = Math.max(0, Math.min(first.yMax, second.yMax)
    - Math.max(first.yMin, second.yMin));
  const minimumHeight = Math.min(first.yMax - first.yMin, second.yMax - second.yMin);
  return minimumHeight > 0 && overlap / minimumHeight >= MIN_JOINED_TOKEN_VERTICAL_OVERLAP_RATIO;
}

function geometricallyAdjacent(previous, next) {
  if (!verticallyOverlap(previous, next)) return false;
  const previousCenter = boxCenter(previous);
  const nextCenter = boxCenter(next);
  if (!(nextCenter.x > previousCenter.x)) return false;
  const minimumHeight = Math.min(previous.yMax - previous.yMin, next.yMax - next.yMin);
  const maximumGap = Math.max(2, minimumHeight * MAX_JOINED_TOKEN_GAP_HEIGHT_RATIO);
  return next.xMin - previous.xMax <= maximumGap;
}

function adjacentTokenWindows(items, used, boxKey) {
  const windowsByText = new Map();
  for (let start = 0; start < items.length; start += 1) {
    if (used.has(items[start])) continue;
    let text = items[start].normalized;
    for (let length = 2; length <= MAX_JOINED_TOKENS; length += 1) {
      const end = start + length;
      const part = items[end - 1];
      if (!part || used.has(part)) break;
      if (!geometricallyAdjacent(items[end - 2][boxKey], part[boxKey])) break;
      text += part.normalized;
      if (!text || text.length > MAX_JOINED_TOKEN_CHARS) break;
      const parts = items.slice(start, end);
      const window = { parts, box: unionAxisBoxes(parts.map((item) => item[boxKey])) };
      const candidates = windowsByText.get(text) ?? [];
      candidates.push(window);
      windowsByText.set(text, candidates);
    }
  }
  return windowsByText;
}

function closestUnusedWindow(singleBox, windows, used) {
  const singleCenter = boxCenter(singleBox);
  let selected = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const window of windows ?? []) {
    if (window.parts.some((part) => used.has(part))) continue;
    const center = boxCenter(window.box);
    const distance = Math.hypot(singleCenter.x - center.x, singleCenter.y - center.y);
    if (distance < selectedDistance) {
      selected = window;
      selectedDistance = distance;
    }
  }
  return selected;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function orientationConsensusWords(page, correctionDegrees) {
  const upright = correctPageOrientation(page, correctionDegrees);
  return (upright.words ?? [])
    .map((word) => ({
      token: normaliseWord(String(word?.text ?? "")),
      box: axisBox(word?.vertices ?? [], 1, 1),
    }))
    .filter((word) => word.token && Object.values(word.box).every(Number.isFinite))
    .sort((left, right) => {
      const leftCenter = boxCenter(left.box);
      const rightCenter = boxCenter(right.box);
      return leftCenter.y - rightCenter.y
        || leftCenter.x - rightCenter.x
        || left.token.localeCompare(right.token, "da-DK");
    });
}

function orientationVariantsAgree(reference, candidate, correctionDegrees) {
  const referenceWords = orientationConsensusWords(reference, correctionDegrees);
  const candidateWords = orientationConsensusWords(candidate, correctionDegrees);
  if (!referenceWords.length || referenceWords.length !== candidateWords.length) return false;
  const pageDiagonal = Math.hypot(reference.imageWidth, reference.imageHeight);
  const maximumCenterDistance = Math.max(2,
    pageDiagonal * MAX_UNREADABLE_RECOVERY_CENTER_DISTANCE_RATIO);
  const overlaps = [];
  for (let index = 0; index < referenceWords.length; index += 1) {
    if (referenceWords[index].token !== candidateWords[index].token) return false;
    const overlap = intersectionOverUnion(referenceWords[index].box, candidateWords[index].box);
    const referenceCenter = boxCenter(referenceWords[index].box);
    const candidateCenter = boxCenter(candidateWords[index].box);
    if (overlap < MIN_UNREADABLE_RECOVERY_WORD_IOU
      || Math.hypot(
        referenceCenter.x - candidateCenter.x,
        referenceCenter.y - candidateCenter.y,
      ) > maximumCenterDistance) return false;
    overlaps.push(overlap);
  }
  return median(overlaps) >= MIN_UNREADABLE_RECOVERY_MEDIAN_IOU;
}

/**
 * Accept a formerly ambiguous orientation only when at least two distinct
 * cardinal retry rasters independently pass the unchanged local orientation
 * gate (>= 0.70 plus its existing evidence requirement), infer exactly the
 * same canonical correction and return exactly the same normalized word
 * multiset. Any decisive conflict remains manual review.
 */
export function recoverOrientationPageFromVariants(variantPages) {
  if (!Array.isArray(variantPages) || variantPages.length !== 4) return null;
  const reliable = [];
  const seenRotations = new Set();
  for (const page of variantPages) {
    if (!Number.isSafeInteger(page?.recoveryRotationDegrees)
      || seenRotations.has(page.recoveryRotationDegrees)) return null;
    seenRotations.add(page.recoveryRotationDegrees);
    const orientation = detectPhysicalOrientation(page);
    if (!orientation.reliable) continue;
    if (!orientationConsensusWords(page, orientation.correctionDegrees).length) continue;
    reliable.push({ page, orientation });
  }
  if (reliable.length < MIN_ORIENTATION_RECOVERY_VARIANTS) return null;
  const correction = reliable[0].orientation.correctionDegrees;
  if (reliable.some((candidate) => candidate.orientation.correctionDegrees !== correction)) return null;
  const selected = [...reliable].sort((left, right) => (
    right.orientation.acceptedWords - left.orientation.acceptedWords
      || right.orientation.confidence - left.orientation.confidence
      || left.page.recoveryRotationDegrees - right.page.recoveryRotationDegrees
  ))[0];
  if (reliable.some((candidate) => !orientationVariantsAgree(
    selected.page,
    candidate.page,
    correction,
  ))) return null;
  return {
    ...selected.page,
    recoveryProfile: "vision-cardinal-orientation-consensus-v1",
  };
}

function sanitisePageNumbers(values, pageCount) {
  const maximum = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 0;
  return [...new Set((values ?? []).filter((value) => (
    Number.isSafeInteger(value) && value >= 1 && value <= maximum
  )))].sort((left, right) => left - right);
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
    const expectedGroups = new Map();
    const expectedEntries = [];
    for (const expected of geometry.words) {
      const normalized = normaliseWord(expected.text);
      if (!normalized) continue;
      expectedWords += 1;
      if (!canMeasurePage) continue;
      const target = axisBox(expected.vertices, scaleX, scaleY);
      const polygon = expected.vertices.map((vertex) => ({
        x: vertex.x * scaleX, y: vertex.y * scaleY,
      }));
      const entry = { expected, target, polygon, normalized };
      expectedEntries.push(entry);
      const group = expectedGroups.get(normalized) ?? [];
      group.push(entry);
      expectedGroups.set(normalized, group);
    }
    if (!canMeasurePage) continue;
    const actualGroups = new Map();
    const actualEntries = [];
    for (const candidate of actualPage.words) {
      const normalized = normaliseWord(candidate.text);
      if (!normalized) continue;
      const entry = { candidate, box: candidate, normalized };
      actualEntries.push(entry);
      const group = actualGroups.get(normalized) ?? [];
      group.push(entry);
      actualGroups.set(normalized, group);
    }
    const pageDiagonal = Math.hypot(actualPage.width, actualPage.height);
    const exactAssignmentBudget = { remaining: MAX_EXACT_ASSIGNMENT_WORK_PER_PAGE };
    const usedExpected = new Set();
    const usedActual = new Set();
    const recordMatch = ({ expectedParts, actualParts, target, actualBox, polygon = null }) => {
      const weight = expectedParts.length;
      const iou = intersectionOverUnion(target, actualBox);
      matchedWords += weight;
      for (let count = 0; count < weight; count += 1) ious.push(iou);
      const actualCenter = boxCenter(actualBox);
      const expectedCenter = polygon ? polygonCenter(polygon) : boxCenter(target);
      const centersAligned = polygon
        ? pointInPolygonInclusive(actualCenter, polygon)
          || pointInAxisBoxInclusive(expectedCenter, actualBox)
        : pointInAxisBoxInclusive(actualCenter, target)
          || pointInAxisBoxInclusive(expectedCenter, actualBox);
      if (centersAligned) centerInside += weight;
      if (centersAligned && iou >= 0.75) passed += weight;
      for (const part of expectedParts) usedExpected.add(part);
      for (const part of actualParts) usedActual.add(part);
    };
    for (const [normalized, expectedGroup] of expectedGroups) {
      const actualGroup = actualGroups.get(normalized) ?? [];
      for (const match of assignEqualWords(
        expectedGroup,
        actualGroup,
        pageDiagonal,
        exactAssignmentBudget,
      )) {
        // Poppler and Vision may round opposite sides of a slanted word box.
        // Requiring either box's centre to be contained in the other is robust
        // to that representation difference without relaxing the 0.75 IoU gate.
        recordMatch({
          expectedParts: [match.expected],
          actualParts: [match.actual],
          target: match.expected.target,
          actualBox: match.actual.box,
          polygon: match.expected.polygon,
        });
      }
    }

    // PDF text extractors may split a Vision token at a hyphen/ligature or join
    // two adjacent Vision tokens. Reconcile only 1:n or n:1 adjacent sequences,
    // bounded to eight tokens and 96 normalised characters. Text still has to
    // match exactly after the same normalisation, and the unchanged centre/IoU
    // gates verify the union box.
    const actualWindows = adjacentTokenWindows(actualEntries, usedActual, "box");
    for (const expected of expectedEntries) {
      if (usedExpected.has(expected)) continue;
      const window = closestUnusedWindow(
        expected.target,
        actualWindows.get(expected.normalized),
        usedActual,
      );
      if (!window) continue;
      recordMatch({
        expectedParts: [expected],
        actualParts: window.parts,
        target: expected.target,
        actualBox: window.box,
        polygon: expected.polygon,
      });
    }
    const expectedWindows = adjacentTokenWindows(expectedEntries, usedExpected, "target");
    for (const actual of actualEntries) {
      if (usedActual.has(actual)) continue;
      const window = closestUnusedWindow(
        actual.box,
        expectedWindows.get(actual.normalized),
        usedExpected,
      );
      if (!window) continue;
      recordMatch({
        expectedParts: window.parts,
        actualParts: [actual],
        target: window.box,
        actualBox: actual.box,
      });
    }
  }
  const matchCoverage = expectedWords ? matchedWords / expectedWords : 0;
  const placementAccuracy = matchedWords ? passed / matchedWords : 0;
  // Coverage and placement are independent quality dimensions. Persist the
  // weaker result so the database's 95% gate remains fail-closed, without
  // penalising an unmatched token twice by multiplying the two ratios.
  const score = Math.min(matchCoverage, placementAccuracy);
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

async function auditSpatialOverlay({
  outputPath,
  artifactLabel,
  workDir,
  runCommand,
  limits,
  geometryPages,
  assertProcessingHealthy,
}) {
  const bboxPath = join(workDir, `${artifactLabel}-bbox.html`);
  const textPath = join(workDir, `${artifactLabel}-text.txt`);
  try {
    await runCommand(
      "pdftotext",
      ["-cropbox", "-bbox-layout", outputPath, bboxPath],
      120_000,
    );
    const extractedPages = parsePdftotextBbox(await readTextArtifactWithinLimit(
      bboxPath,
      limits.maxPdfBboxBytes,
    ));
    assertProcessingHealthy();
    const spatial = computeSpatialAccuracy(geometryPages, extractedPages);
    await runCommand("pdftotext", [outputPath, textPath], 120_000);
    const finalText = await readTextArtifactWithinLimit(textPath, limits.maxPdfTextBytes);
    assertProcessingHealthy();
    const textCharCount = finalText.replace(/\s/g, "").length;
    return {
      extractedPages,
      spatial,
      textCharCount,
      passed: spatial.passed && textCharCount >= MIN_SPATIAL_TEXT_CHARS,
    };
  } finally {
    // Extracted text is sensitive and only needed for this in-memory gate.
    // Remove it immediately rather than waiting for whole-workdir cleanup.
    await Promise.all([
      rm(bboxPath, { force: true }),
      rm(textPath, { force: true }),
    ]);
  }
}

export async function processPdfSpatially({
  inputPath,
  outputPath,
  geometryPath,
  workDir,
  commandRunner,
  googleClient,
  assertLeaseHealthy = () => {},
  forceOcr = false,
  resourceLimits,
  signal,
}) {
  const assertProcessingHealthy = () => {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("processing_aborted");
    assertLeaseHealthy();
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("processing_aborted");
  };
  const runCommand = async (command, args, timeoutMs, commandOptions = {}) => {
    assertProcessingHealthy();
    const result = await commandRunner(command, args, timeoutMs, { ...commandOptions, signal });
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
    const listedImages = await runCommand("pdfimages", ["-list", inputPath], 60_000, {
      // A dense PDF can produce megabytes of inventory. Keeping only the tail
      // loses the header and forces the native-text classifier to fail closed.
      stdoutMode: "full",
      maxStdoutBytes: 4 * 1024 * 1024,
    });
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
  // document is deliberately sent through Vision for every page before
  // rebuilding the safe derivative, but a native source page must not then
  // count as both native and OCR-required in completion evidence.
  const sourceNativePageCount = pageStates
    .filter((page) => page.classification === "native_text").length;
  const pagesNeedingOcr = pageStates.filter((page) => page.classification !== "native_text");
  if (pagesNeedingOcr.length === 0 && !forceOcr) {
    return {
      status: "not_required",
      classification: "native_text",
      pageCount,
      nativePageCount: sourceNativePageCount,
      ocrPageCount: 0,
      unreadablePageCount: 0,
      orientationCorrections: [],
      textCharCount: pageStates.reduce((total, page) => total + page.chars, 0),
    };
  }
  const { nativePageCount, ocrPageCount } = completionPageCounts(pageStates, forceOcr);
  const ocrDocumentClassification = classifyOcrDocument(pageStates);

  // A document that needs OCR is rebuilt consistently from the raw page rasters.
  // Processing every page keeps a mixed document's geometry and text layer on
  // one deterministic representation.
  const pagesForOcr = [];
  let retainedRasterBytes = 0;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    assertProcessingHealthy();
    const prefix = join(workDir, `page-${pageNumber}`);
    const pageSize = pageStates[pageNumber - 1]?.pageSize;
    if (!pageSize) throw new GoogleOcrOperationalError("page_geometry_unavailable");
    let imageBytes = null;
    for (const profile of VISION_RENDER_PROFILES) {
      assertProcessingHealthy();
      if (renderedPixelCount(pageSize, profile.dpi) > MAX_RENDERED_PAGE_PIXELS) continue;
      await runCommand("pdftoppm", [
        "-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-cropbox",
        "-jpeg", "-jpegopt", `quality=${profile.quality}`, "-r", String(profile.dpi),
        "-gray", inputPath, prefix,
      ], 120_000);
      const candidatePath = `${prefix}.jpg`;
      const candidateInfo = await stat(candidatePath);
      if (candidateInfo.size > MAX_VISION_IMAGE_BYTES) continue;
      const candidate = await readFile(candidatePath);
      imageBytes = candidate;
      break;
    }
    if (!imageBytes) throw new GoogleOcrOperationalError("vision_page_too_large");
    retainedRasterBytes += imageBytes.length;
    if (retainedRasterBytes > limits.maxDocumentRasterBytes) {
      throw new GoogleOcrOperationalError("document_raster_budget_exceeded");
    }
    pagesForOcr.push({ pageNumber, imageBytes });
  }

  assertProcessingHealthy();
  const {
    responses,
    sourcePages,
    visionPageTransforms,
    retainedRasterBytes: retainedGoogleRasterBytes,
    retainedVisionResponseBytes,
  } = await googleClient.annotateDocument(
    pagesForOcr,
    { assertHealthy: assertProcessingHealthy, resourceLimits: limits, signal },
  );
  assertProcessingHealthy();
  const transformByPage = new Map((visionPageTransforms ?? []).map((transform) => [
    transform.pageNumber,
    transform,
  ]));
  const rawGeometryPages = responses.map((response, index) => {
    const pageNumber = pagesForOcr[index].pageNumber;
    return mapVisionPageToCanonical(
      extractVisionPage(response, pageNumber),
      transformByPage.get(pageNumber),
    );
  });
  const initialVisionWordCount = enforceVisionWordLimits(rawGeometryPages, limits);
  let retainedRecoveryRasterBytes = Number.isSafeInteger(retainedGoogleRasterBytes)
    ? retainedGoogleRasterBytes
    : retainedRasterBytes;
  let retainedRecoveryResponseBytes = Number.isSafeInteger(retainedVisionResponseBytes)
    ? retainedVisionResponseBytes
    : 0;
  let retainedRetryWordCount = 0;
  const sourcePageByNumber = new Map((sourcePages ?? []).map((page) => [page.pageNumber, page]));
  const blankPageNumbers = new Set();
  const verifiedBlankCandidates = new Map();
  const blankInspectionByPage = new Map();
  // A completely blank document is still rejected. Within an otherwise
  // readable document, however, a verified blank page is preserved in its
  // original position without being mistaken for an OCR failure.
  for (const page of rawGeometryPages) {
    if (page.words.length > 0) continue;
    const pageState = pageStates[page.pageNumber - 1];
    const sourcePage = sourcePageByNumber.get(page.pageNumber);
    if (!pageState || pageState.chars > 0 || !sourcePage?.imageBytes) continue;
    const inspection = await inspectRasterBlankness(sourcePage.imageBytes);
    assertProcessingHealthy();
    blankInspectionByPage.set(page.pageNumber, inspection);
    if (!inspection.blank || !(inspection.width > 0) || !(inspection.height > 0)) continue;
    verifiedBlankCandidates.set(page.pageNumber, inspection);
  }
  const promoteVerifiedBlankCandidates = () => {
    if (!rawGeometryPages.some((page) => page.words.length > 0)) return;
    for (const [pageNumber, inspection] of verifiedBlankCandidates) {
      const page = rawGeometryPages.find((candidate) => candidate.pageNumber === pageNumber);
      if (!page || page.words.length > 0) continue;
      blankPageNumbers.add(pageNumber);
      page.imageWidth = inspection.width;
      page.imageHeight = inspection.height;
    }
  };
  promoteVerifiedBlankCandidates();

  const recoveryCandidates = rawGeometryPages.filter((page) => (
    page.words.length === 0
      && !verifiedBlankCandidates.has(page.pageNumber)
  ));
  if (recoveryCandidates.length > 0
    && recoveryCandidates.length <= MAX_UNREADABLE_RECOVERY_PAGES
    && typeof googleClient.annotateUnreadablePageVariants === "function") {
    for (const page of recoveryCandidates) {
      assertProcessingHealthy();
      const sourceTransform = transformByPage.get(page.pageNumber);
      if (!(sourceTransform?.sourceWidth > 0) || !(sourceTransform?.sourceHeight > 0)) continue;
      const recoveryPrefix = join(workDir, `recovery-colour-${page.pageNumber}`);
      await runCommand("pdftoppm", [
        "-f", String(page.pageNumber), "-l", String(page.pageNumber), "-singlefile", "-cropbox",
        "-jpeg", "-jpegopt", "quality=96",
        "-scale-to-x", String(sourceTransform.sourceWidth),
        "-scale-to-y", String(sourceTransform.sourceHeight),
        inputPath, recoveryPrefix,
      ], 120_000);
      const recoveryPath = `${recoveryPrefix}.jpg`;
      const recoveryInfo = await stat(recoveryPath);
      const remainingRasterBytes = limits.maxDocumentTotalRasterBytes - retainedRecoveryRasterBytes;
      const remainingResponseBytes = limits.maxVisionResponseBytesTotal
        - retainedRecoveryResponseBytes;
      if (recoveryInfo.size < 1 || recoveryInfo.size > MAX_VISION_IMAGE_BYTES
        || recoveryInfo.size >= remainingRasterBytes || remainingResponseBytes < 1) continue;
      const recoveryImageBytes = await readFile(recoveryPath);
      const retry = await googleClient.annotateUnreadablePageVariants({
        pageNumber: page.pageNumber,
        imageBytes: recoveryImageBytes,
      }, {
        assertHealthy: assertProcessingHealthy,
        resourceLimits: limits,
        signal,
        maxAdditionalRasterBytes: remainingRasterBytes - recoveryImageBytes.length,
        maxAdditionalResponseBytes: remainingResponseBytes,
      });
      retainedRecoveryRasterBytes += recoveryImageBytes.length
        + Number(retry.retainedRasterBytes || 0);
      retainedRecoveryResponseBytes += Number(retry.retainedVisionResponseBytes || 0);
      const recoveredVariants = (retry.variants ?? []).map((variant) => {
        const retryPage = mapVisionPageToCanonical(
          extractVisionPage(variant.response, page.pageNumber),
          variant.transform,
        );
        if (Math.abs(retryPage.imageWidth - page.imageWidth) <= 1
          && Math.abs(retryPage.imageHeight - page.imageHeight) <= 1) return retryPage;
        return mapVisionPageToCanonical(retryPage, {
          pageNumber: page.pageNumber,
          sourceWidth: page.imageWidth,
          sourceHeight: page.imageHeight,
          visionWidth: retryPage.imageWidth,
          visionHeight: retryPage.imageHeight,
        });
      });
      let retryWordCount = 0;
      for (const variantPage of recoveredVariants) {
        retryWordCount += enforceVisionWordLimits([variantPage], limits);
      }
      if (initialVisionWordCount + retainedRetryWordCount + retryWordCount
        > limits.maxVisionWordsTotal) {
        throw new GoogleOcrOperationalError("vision_word_limit_exceeded");
      }
      retainedRetryWordCount += retryWordCount;
      const recovered = recoverUnreadablePageFromVariants(recoveredVariants.slice(0, 2))
        ?? recoverSparseTailTextFromVariants(recoveredVariants, {
          pageNumber: page.pageNumber,
          pageCount,
        });
      if (recovered) {
        rawGeometryPages[page.pageNumber - 1] = recovered;
        continue;
      }
      const sourceEvidence = blankInspectionByPage.get(page.pageNumber);
      const recoveryEvidence = await inspectRasterBlankness(recoveryImageBytes);
      assertProcessingHealthy();
      if (hasSparseTailBlankConsensus({
        pageNumber: page.pageNumber,
        pageCount,
        variantPages: recoveredVariants,
        sourceEvidence,
        recoveryEvidence,
      })) {
        verifiedBlankCandidates.set(page.pageNumber, {
          ...sourceEvidence,
          width: page.imageWidth,
          height: page.imageHeight,
        });
      }
    }
    enforceVisionWordLimits(rawGeometryPages, limits);
    // A page verified as blank before recovery remains only a candidate until
    // another page has independently produced readable OCR. Re-evaluate that
    // document-level condition after all bounded retries.
    promoteVerifiedBlankCandidates();
  }

  const sparseTailOrientationByPage = new Map();
  let orientationByPage = resolvePhysicalOrientations(rawGeometryPages);
  const orientationRecoveryCandidates = rawGeometryPages.filter((page) => (
    page.words.length > 0 && !orientationByPage.get(page.pageNumber).reliable
  ));
  if (orientationRecoveryCandidates.length > 0
    && orientationRecoveryCandidates.length <= MAX_ORIENTATION_RECOVERY_PAGES
    && typeof googleClient.annotateOrientationPageVariants === "function") {
    for (const page of orientationRecoveryCandidates) {
      assertProcessingHealthy();
      const sourcePage = sourcePageByNumber.get(page.pageNumber);
      const remainingRasterBytes = limits.maxDocumentTotalRasterBytes
        - retainedRecoveryRasterBytes;
      const remainingResponseBytes = limits.maxVisionResponseBytesTotal
        - retainedRecoveryResponseBytes;
      if (!sourcePage?.imageBytes || remainingRasterBytes < 1 || remainingResponseBytes < 1) continue;
      const retry = await googleClient.annotateOrientationPageVariants({
        pageNumber: page.pageNumber,
        imageBytes: sourcePage.imageBytes,
      }, {
        assertHealthy: assertProcessingHealthy,
        resourceLimits: limits,
        signal,
        maxAdditionalRasterBytes: remainingRasterBytes,
        maxAdditionalResponseBytes: remainingResponseBytes,
      });
      retainedRecoveryRasterBytes += Number(retry.retainedRasterBytes || 0);
      retainedRecoveryResponseBytes += Number(retry.retainedVisionResponseBytes || 0);
      const recoveredVariants = (retry.variants ?? []).map((variant) => (
        mapOrientationVariantToCanonical(
          mapVisionPageToCanonical(
            extractVisionPage(variant.response, page.pageNumber),
            variant.transform,
          ),
          variant.transform,
        )
      ));
      let retryWordCount = 0;
      for (const variantPage of recoveredVariants) {
        retryWordCount += enforceVisionWordLimits([variantPage], limits);
      }
      if (initialVisionWordCount + retainedRetryWordCount + retryWordCount
        > limits.maxVisionWordsTotal) {
        throw new GoogleOcrOperationalError("vision_word_limit_exceeded");
      }
      retainedRetryWordCount += retryWordCount;
      const recovered = recoverOrientationPageFromVariants(recoveredVariants);
      if (recovered) {
        rawGeometryPages[page.pageNumber - 1] = recovered;
        continue;
      }
      const sparseRecovery = recoverSparseTailOrientationFromVariants(recoveredVariants, {
        pageNumber: page.pageNumber,
        pageCount,
      });
      if (sparseRecovery) {
        rawGeometryPages[page.pageNumber - 1] = sparseRecovery.page;
        sparseTailOrientationByPage.set(page.pageNumber, sparseRecovery.orientation);
      }
    }
    enforceVisionWordLimits(rawGeometryPages, limits);
    orientationByPage = resolvePhysicalOrientations(rawGeometryPages);
    for (const [pageNumber, orientation] of sparseTailOrientationByPage) {
      orientationByPage.set(pageNumber, orientation);
    }
  }
  const orientationCorrections = rawGeometryPages
    .map((page) => ({ page: page.pageNumber, degrees: orientationByPage.get(page.pageNumber).correctionDegrees }))
    .filter((entry) => entry.degrees !== 0);
  const orientationUncertainPageNumbers = sanitisePageNumbers(
    rawGeometryPages.filter((page) => (
      page.words.length > 0 && !orientationByPage.get(page.pageNumber).reliable
    )).map((page) => page.pageNumber),
    pageCount,
  );
  const orientationUncertainPageCount = orientationUncertainPageNumbers.length;
  const blankPageCount = blankPageNumbers.size;
  const unreadablePageNumbers = sanitisePageNumbers(
    rawGeometryPages.filter((page) => (
      page.words.length === 0 && !blankPageNumbers.has(page.pageNumber)
    )).map((page) => page.pageNumber),
    pageCount,
  );
  const unreadablePageCount = unreadablePageNumbers.length;
  if (unreadablePageCount > 0) {
    return {
      status: "needs_review", classification: "unreadable", pageCount,
      nativePageCount,
      ocrPageCount,
      unreadablePageCount,
      orientationCorrections,
      orientationUncertainPageCount,
      affectedPageNumbers: unreadablePageNumbers,
      blankPageCount,
      processingProfile: "google-vision-direct-v1",
      spatialSchemaVersion: "google-vision-spatial-v3",
    };
  }
  if (orientationUncertainPageCount > 0) {
    return {
      status: "needs_review", classification: ocrDocumentClassification, pageCount,
      nativePageCount,
      ocrPageCount,
      unreadablePageCount,
      orientationCorrections,
      orientationUncertainPageCount,
      affectedPageNumbers: orientationUncertainPageNumbers,
      blankPageCount,
      orientationQualityFailed: true,
      processingProfile: "google-vision-direct-v1",
      spatialSchemaVersion: "google-vision-spatial-v3",
    };
  }

  const geometryPages = rawGeometryPages.map((page) => {
    const orientation = orientationByPage.get(page.pageNumber);
    return canonicaliseSpatialGeometryPage(page, orientation.correctionDegrees);
  });
  const geometry = {
    schemaVersion: "google-vision-spatial-v3",
    engine: "google-vision-document-text-detection",
    processingProfile: "google-vision-direct-v1",
    pages: geometryPages,
  };
  const plainGeometryPath = join(workDir, "vision-geometry.json");
  await writeFile(
    plainGeometryPath,
    serializeSpatialGeometry(geometry, limits.maxSpatialJsonBytes),
    { mode: 0o600 },
  );
  assertProcessingHealthy();
  for (const page of sourcePages) {
    const sourcePath = join(workDir, `ocr-source-${page.pageNumber}.jpg`);
    const outputImagePath = join(workDir, `ocr-page-${page.pageNumber}.png`);
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
    String(25 * 1024 * 1024),
  ], 180_000);
  let selectedOverlayProfile = "primary-v1";
  let overlayAudit = await auditSpatialOverlay({
    outputPath,
    artifactLabel: "output-primary",
    workDir,
    runCommand,
    limits,
    geometryPages,
    assertProcessingHealthy,
  });

  // Keep the established output as the primary candidate. Only if its full,
  // unchanged text/spatial audit fails do we try a small fixed candidate set,
  // built from the exact same Vision response and canonical page rasters.
  // Failed candidates are deleted immediately and can never reach Storage.
  if (!overlayAudit.passed) {
    for (const overlayProfile of SPATIAL_OVERLAY_FALLBACK_PROFILES) {
      const candidatePath = join(workDir, `output-${overlayProfile}.pdf`);
      let accepted = false;
      try {
        await runCommand("python3", [
          join(process.cwd(), "vision_overlay.py"),
          inputPath,
          plainGeometryPath,
          workDir,
          candidatePath,
          String(25 * 1024 * 1024),
          overlayProfile,
        ], 180_000);
        const candidateAudit = await auditSpatialOverlay({
          outputPath: candidatePath,
          artifactLabel: `output-${overlayProfile}`,
          workDir,
          runCommand,
          limits,
          geometryPages,
          assertProcessingHealthy,
        });
        if (candidateAudit.passed) {
          await rename(candidatePath, outputPath);
          assertProcessingHealthy();
          selectedOverlayProfile = overlayProfile;
          overlayAudit = candidateAudit;
          accepted = true;
          break;
        }
      } catch {
        // A bounded optional candidate must never turn a correctly diagnosed
        // primary needs_review result into a fatal document failure. Lease and
        // deadline failures still propagate through this health assertion.
        assertProcessingHealthy();
      } finally {
        if (!accepted) await rm(candidatePath, { force: true });
      }
    }
  }

  const { extractedPages, spatial, textCharCount } = overlayAudit;
  // Persist the independently measured metrics only after the derivative has
  // been rebuilt and verified. The uploaded artefact therefore cannot claim
  // spatial success based solely on Vision's source geometry.
  const verifiedGeometry = {
    ...geometry,
    overlayProfile: selectedOverlayProfile,
    spatialVerification: spatial,
  };
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
  const spatialPassed = overlayAudit.passed;
  let spatialPageNumbers = sanitisePageNumbers(
    geometryPages.filter((page) => page.words.length > 0 && (
      !spatial.passed
        ? !computeSpatialAccuracy([page], extractedPages).passed
        : textCharCount < 120
    )).map((page) => page.pageNumber),
    pageCount,
  );
  if (!spatialPassed && spatialPageNumbers.length === 0) {
    spatialPageNumbers = sanitisePageNumbers(
      geometryPages.filter((page) => page.words.length > 0).map((page) => page.pageNumber),
      pageCount,
    );
  }
  return {
    status: spatialPassed ? "completed" : "needs_review",
    classification: ocrDocumentClassification,
    pageCount,
    nativePageCount,
    ocrPageCount,
    unreadablePageCount,
    blankPageCount,
    orientationCorrections,
    orientationUncertainPageCount,
    processingProfile: "google-vision-direct-v1",
    spatialSchemaVersion: "google-vision-spatial-v3",
    spatial,
    textCharCount,
    affectedPageNumbers: spatialPassed ? [] : spatialPageNumbers,
  };
}
