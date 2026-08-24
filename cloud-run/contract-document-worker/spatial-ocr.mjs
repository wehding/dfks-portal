import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const gzipAsync = promisify(gzip);
const MIN_NATIVE_CHARS = 40;
const MIN_NATIVE_WORDS = 8;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function usefulText(text) {
  const compact = text.replace(/\s/g, "");
  const words = text.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const invalidRatio = compact.length ? (compact.match(/\uFFFD/g)?.length ?? 0) / compact.length : 0;
  return { chars: compact.length, words: words.length, invalidRatio };
}

export function classifyPageText(text) {
  const quality = usefulText(text);
  if (quality.invalidRatio < 0.01 && (quality.chars >= MIN_NATIVE_CHARS || quality.words >= MIN_NATIVE_WORDS)) {
    return { classification: "native_text", ...quality };
  }
  return { classification: quality.chars > 0 ? "mixed" : "image_only", ...quality };
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
  let measurable = 0;
  let passed = 0;
  let centerInside = 0;
  const ious = [];
  for (const geometry of geometryPages) {
    const actualPage = extractedPages[geometry.pageNumber - 1];
    if (!actualPage || !geometry.imageWidth || !geometry.imageHeight) continue;
    const scaleX = actualPage.width / geometry.imageWidth;
    const scaleY = actualPage.height / geometry.imageHeight;
    const unused = new Set(actualPage.words.map((_, index) => index));
    for (const expected of geometry.words) {
      const normalized = normaliseWord(expected.text);
      if (!normalized) continue;
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
      measurable += 1;
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
  const score = measurable ? passed / measurable : 0;
  const centerInsideRatio = measurable ? centerInside / measurable : 0;
  const medianIou = median(ious);
  return {
    measurableWords: measurable,
    score,
    medianIou,
    centerInsideRatio,
    passed: measurable > 0 && score >= 0.95 && medianIou >= 0.85 && centerInsideRatio >= 0.98,
  };
}

export async function processPdfSpatially({
  inputPath,
  outputPath,
  geometryPath,
  workDir,
  commandRunner,
  googleClient,
}) {
  const info = await commandRunner("pdfinfo", [inputPath], 30_000);
  const pageCount = Number(info.stdout.match(/Pages:\s+(\d+)/i)?.[1] || 0);
  if (!pageCount || pageCount > 10_000) throw new Error("invalid_page_count");

  const pageStates = [];
  const pagesForOcr = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const textPath = join(workDir, `native-${pageNumber}.txt`);
    await commandRunner("pdftotext", ["-f", String(pageNumber), "-l", String(pageNumber), inputPath, textPath], 60_000);
    const nativeText = await readFile(textPath, "utf8").catch(() => "");
    const classification = classifyPageText(nativeText);
    pageStates.push({ pageNumber, ...classification });
    if (classification.classification === "native_text") continue;

    const prefix = join(workDir, `page-${pageNumber}`);
    await commandRunner("pdftoppm", [
      "-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-cropbox",
      "-jpeg", "-jpegopt", "quality=95", "-r", "300", "-gray", inputPath, prefix,
    ], 120_000);
    const imageBytes = await readFile(`${prefix}.jpg`);
    if (imageBytes.length > 6 * 1024 * 1024) throw new Error("vision_page_too_large");
    pagesForOcr.push({ pageNumber, imageBytes });
  }

  if (pagesForOcr.length === 0) {
    return {
      status: "not_required",
      classification: "native_text",
      pageCount,
      nativePageCount: pageCount,
      ocrPageCount: 0,
      unreadablePageCount: 0,
      textCharCount: pageStates.reduce((total, page) => total + page.chars, 0),
    };
  }

  const { responses, redactionCounts } = await googleClient.redactAndAnnotate(pagesForOcr);
  const geometryPages = responses.map((response, index) => extractVisionPage(response, pagesForOcr[index].pageNumber));
  const unreadablePageCount = geometryPages.filter((page) => page.words.length === 0).length;
  if (unreadablePageCount > 0) {
    return {
      status: "needs_review", classification: "unreadable", pageCount,
      nativePageCount: pageCount - pagesForOcr.length, ocrPageCount: pagesForOcr.length,
      unreadablePageCount, redactionCounts,
    };
  }

  const geometry = {
    schemaVersion: "google-vision-spatial-v1",
    engine: "google-vision-document-text-detection",
    pages: geometryPages,
  };
  await writeFile(geometryPath, await gzipAsync(Buffer.from(JSON.stringify(geometry))), { mode: 0o600 });
  const plainGeometryPath = join(workDir, "vision-geometry.json");
  await writeFile(plainGeometryPath, JSON.stringify(geometry), { mode: 0o600 });
  await commandRunner("python3", [join(process.cwd(), "vision_overlay.py"), inputPath, plainGeometryPath, outputPath], 180_000);

  const bboxPath = join(workDir, "output-bbox.html");
  await commandRunner("pdftotext", ["-bbox-layout", outputPath, bboxPath], 120_000);
  const extractedPages = parsePdftotextBbox(await readFile(bboxPath, "utf8"));
  const spatial = computeSpatialAccuracy(geometryPages, extractedPages);
  const finalTextPath = join(workDir, "output-text.txt");
  await commandRunner("pdftotext", [outputPath, finalTextPath], 120_000);
  const finalText = await readFile(finalTextPath, "utf8").catch(() => "");
  const textCharCount = finalText.replace(/\s/g, "").length;
  const nativePageCount = pageCount - pagesForOcr.length;
  const classification = nativePageCount === 0 && pageStates.every((page) => page.classification === "image_only")
    ? "image_only" : "mixed";
  return {
    status: spatial.passed && textCharCount >= 120 ? "completed" : "needs_review",
    classification,
    pageCount,
    nativePageCount,
    ocrPageCount: pagesForOcr.length,
    unreadablePageCount,
    redactionCounts,
    spatial,
    textCharCount,
  };
}
