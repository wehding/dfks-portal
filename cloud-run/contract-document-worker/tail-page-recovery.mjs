const MIN_VARIANT_CONSENSUS = 2;
const MIN_ORIENTATION_VARIANT_CONSENSUS = 3;
const MAX_SPARSE_TAIL_WORDS = 8;
const MIN_SPARSE_TEXT_CHARS = 5;
const MIN_SPARSE_TEXT_CONFIDENCE = 0.9;
const MIN_SPARSE_ORIENTATION_BASELINE_RATIO = 0.02;
const MIN_WORD_IOU = 0.65;
const MIN_MEDIAN_WORD_IOU = 0.85;
const MAX_CENTER_DISTANCE_RATIO = 0.01;

// These limits are deliberately only a small extension of the ordinary blank
// gate. Two separately rendered rasters and every Vision enhancement must
// agree before a sparse final page can be classified as blank.
const MAX_TAIL_BLANK_NON_WHITE_RATIO = 0.006;
const MAX_TAIL_BLANK_DARK_RATIO = 0.002;
const MIN_TAIL_BLANK_MEAN = 251;
const MAX_TAIL_BLANK_STDEV = 14;
const MAX_TAIL_BLANK_LOCAL_NON_WHITE_RATIO = 0.06;
const MAX_TAIL_BLANK_LOCAL_DARK_RATIO = 0.015;
const MAX_BLANK_NON_WHITE_DELTA = 0.0025;
const MAX_BLANK_DARK_DELTA = 0.001;
const MAX_BLANK_MEAN_DELTA = 2;
const MAX_BLANK_STDEV_DELTA = 4;

function isTailContext(pageNumber, pageCount) {
  return Number.isSafeInteger(pageNumber)
    && Number.isSafeInteger(pageCount)
    && pageCount >= 2
    && pageCount <= 200
    && pageNumber === pageCount;
}

function normaliseDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function normaliseWord(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("da-DK")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function boxFromVertices(vertices) {
  if (!Array.isArray(vertices) || vertices.length !== 4) return null;
  const xs = vertices.map((point) => Number(point?.x));
  const ys = vertices.map((point) => Number(point?.y));
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  const box = {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  };
  return box.xMax > box.xMin && box.yMax > box.yMin ? box : null;
}

function boxCenter(box) {
  return {
    x: (box.xMin + box.xMax) / 2,
    y: (box.yMin + box.yMax) / 2,
  };
}

function intersectionOverUnion(left, right) {
  const width = Math.max(0, Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin));
  const height = Math.max(0, Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin));
  const intersection = width * height;
  const union = (left.xMax - left.xMin) * (left.yMax - left.yMin)
    + (right.xMax - right.xMin) * (right.yMax - right.yMin)
    - intersection;
  return union > 0 ? intersection / union : 0;
}

function canonicalWords(page) {
  const words = Array.isArray(page?.words) ? page.words : [];
  const width = Number(page?.imageWidth);
  const height = Number(page?.imageHeight);
  if (!(width > 0) || !(height > 0)) return null;
  const canonical = [];
  for (const word of words) {
    const token = normaliseWord(word?.text);
    const box = boxFromVertices(word?.vertices);
    const confidence = Number(word?.confidence);
    if (!token || !box || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
      || box.xMin < -1 || box.yMin < -1
      || box.xMax > width + 1 || box.yMax > height + 1) return null;
    canonical.push({ token, box, confidence });
  }
  return canonical.sort((left, right) => {
    const leftCenter = boxCenter(left.box);
    const rightCenter = boxCenter(right.box);
    return leftCenter.y - rightCenter.y
      || leftCenter.x - rightCenter.x
      || left.token.localeCompare(right.token, "da-DK");
  });
}

function tokenSignature(words) {
  return words.map((word) => word.token).join("\u001f");
}

function geometryAgrees(reference, candidate, width, height) {
  if (!reference.length || reference.length !== candidate.length) return false;
  const maximumCenterDistance = Math.max(2, Math.hypot(width, height) * MAX_CENTER_DISTANCE_RATIO);
  const overlaps = [];
  for (let index = 0; index < reference.length; index += 1) {
    if (reference[index].token !== candidate[index].token) return false;
    const overlap = intersectionOverUnion(reference[index].box, candidate[index].box);
    const referenceCenter = boxCenter(reference[index].box);
    const candidateCenter = boxCenter(candidate[index].box);
    const centerDistance = Math.hypot(
      referenceCenter.x - candidateCenter.x,
      referenceCenter.y - candidateCenter.y,
    );
    if (overlap < MIN_WORD_IOU || centerDistance > maximumCenterDistance) return false;
    overlaps.push(overlap);
  }
  return median(overlaps) >= MIN_MEDIAN_WORD_IOU;
}

function commonDimensions(pages) {
  const first = pages[0];
  const width = Number(first?.imageWidth);
  const height = Number(first?.imageHeight);
  if (!(width > 0) || !(height > 0)) return null;
  if (pages.some((page) => {
    const candidateWidth = Number(page?.imageWidth);
    const candidateHeight = Number(page?.imageHeight);
    return !(candidateWidth > 0) || !(candidateHeight > 0)
      || Math.abs(candidateWidth - width) > 1
      || Math.abs(candidateHeight - height) > 1;
  })) return null;
  return { width, height };
}

/**
 * Recover genuinely sparse tail text only when every non-empty enhancement
 * returns exactly the same normalised words and at least two high-confidence
 * variants also agree tightly on geometry. No single OCR response is trusted.
 */
export function recoverSparseTailTextFromVariants(variantPages, {
  pageNumber,
  pageCount,
} = {}) {
  if (!isTailContext(pageNumber, pageCount)
    || !Array.isArray(variantPages)
    || variantPages.length < MIN_VARIANT_CONSENSUS
    || variantPages.length > 4) return null;
  const dimensions = commonDimensions(variantPages);
  if (!dimensions || variantPages.some((page) => page?.pageNumber !== pageNumber
    || !Array.isArray(page?.words)
    || page.words.length > MAX_SPARSE_TAIL_WORDS)) return null;
  const nonEmpty = [];
  for (let index = 0; index < variantPages.length; index += 1) {
    const words = canonicalWords(variantPages[index]);
    if (words == null) return null;
    if (words.length > 0) nonEmpty.push({ index, page: variantPages[index], words });
  }
  if (nonEmpty.length < MIN_VARIANT_CONSENSUS) return null;
  const signature = tokenSignature(nonEmpty[0].words);
  if (!signature || nonEmpty.some((candidate) => tokenSignature(candidate.words) !== signature)) return null;
  const characterCount = nonEmpty[0].words.reduce((total, word) => total + word.token.length, 0);
  if (characterCount < MIN_SPARSE_TEXT_CHARS) return null;
  const qualified = nonEmpty.filter((candidate) => (
    median(candidate.words.map((word) => word.confidence)) >= MIN_SPARSE_TEXT_CONFIDENCE
  ));
  if (qualified.length < MIN_VARIANT_CONSENSUS) return null;
  const selected = [...qualified].sort((left, right) => (
    median(right.words.map((word) => word.confidence))
      - median(left.words.map((word) => word.confidence))
      || left.index - right.index
  ))[0];
  if (qualified.some((candidate) => !geometryAgrees(
    selected.words,
    candidate.words,
    dimensions.width,
    dimensions.height,
  ))) return null;
  return {
    ...selected.page,
    recoveryProfile: "vision-sparse-tail-text-consensus-v1",
  };
}

function nearBlankEvidence(evidence) {
  return evidence
    && Number(evidence.width) > 0
    && Number(evidence.height) > 0
    && Number(evidence.nonWhiteRatio) <= MAX_TAIL_BLANK_NON_WHITE_RATIO
    && Number(evidence.darkRatio) <= MAX_TAIL_BLANK_DARK_RATIO
    && Number(evidence.mean) >= MIN_TAIL_BLANK_MEAN
    && Number(evidence.stdev) <= MAX_TAIL_BLANK_STDEV
    && Number(evidence.maxLocalNonWhiteRatio) <= MAX_TAIL_BLANK_LOCAL_NON_WHITE_RATIO
    && Number(evidence.maxLocalDarkRatio) <= MAX_TAIL_BLANK_LOCAL_DARK_RATIO;
}

/**
 * A final zero-word page is blank only when all enhancement OCR attempts are
 * empty and two independently rendered rasters both satisfy conservative,
 * mutually consistent image-statistics gates. Zero words alone never suffice.
 */
export function hasSparseTailBlankConsensus({
  pageNumber,
  pageCount,
  variantPages,
  sourceEvidence,
  recoveryEvidence,
} = {}) {
  if (!isTailContext(pageNumber, pageCount)
    || !Array.isArray(variantPages)
    || variantPages.length !== 4
    || variantPages.some((page) => page?.pageNumber !== pageNumber
      || !Array.isArray(page?.words)
      || page.words.length !== 0)
    || !nearBlankEvidence(sourceEvidence)
    || !nearBlankEvidence(recoveryEvidence)) return false;
  const sourceAspect = Number(sourceEvidence.width) / Number(sourceEvidence.height);
  const recoveryAspect = Number(recoveryEvidence.width) / Number(recoveryEvidence.height);
  return Number.isFinite(sourceAspect)
    && Number.isFinite(recoveryAspect)
    && Math.abs(sourceAspect - recoveryAspect) <= 0.005
    && Math.abs(sourceEvidence.nonWhiteRatio - recoveryEvidence.nonWhiteRatio)
      <= MAX_BLANK_NON_WHITE_DELTA
    && Math.abs(sourceEvidence.darkRatio - recoveryEvidence.darkRatio) <= MAX_BLANK_DARK_DELTA
    && Math.abs(sourceEvidence.mean - recoveryEvidence.mean) <= MAX_BLANK_MEAN_DELTA
    && Math.abs(sourceEvidence.stdev - recoveryEvidence.stdev) <= MAX_BLANK_STDEV_DELTA;
}

function nearestQuadrant(value) {
  const angle = normaliseDegrees(value);
  const quadrant = (Math.round(angle / 90) * 90) % 360;
  const distance = Math.min(Math.abs(angle - quadrant), 360 - Math.abs(angle - quadrant));
  return { quadrant, distance };
}

function sparseOrientationEvidence(page) {
  const weights = new Map([[0, 0], [90, 0], [180, 0], [270, 0]]);
  let acceptedWords = 0;
  let totalWeight = 0;
  let totalBaseline = 0;
  const confidences = [];
  for (const word of page?.words ?? []) {
    if (!Array.isArray(word?.vertices) || word.vertices.length !== 4) continue;
    const dx = Number(word.vertices[1]?.x) - Number(word.vertices[0]?.x);
    const dy = Number(word.vertices[1]?.y) - Number(word.vertices[0]?.y);
    const baseline = Math.hypot(dx, dy);
    if (!Number.isFinite(baseline) || baseline < 2) continue;
    const { quadrant, distance } = nearestQuadrant(Math.atan2(dy, dx) * 180 / Math.PI);
    if (distance > 28) continue;
    const confidence = Math.max(0.2, Math.min(1, Number(word.confidence) || 0));
    const weight = baseline * confidence;
    weights.set(quadrant, weights.get(quadrant) + weight);
    totalWeight += weight;
    totalBaseline += baseline;
    confidences.push(confidence);
    acceptedWords += 1;
  }
  if (!acceptedWords || !(totalWeight > 0)) return null;
  const [detectedDegrees, dominantWeight] = [...weights.entries()]
    .sort((left, right) => right[1] - left[1])[0];
  const confidence = dominantWeight / totalWeight;
  const words = canonicalWords(page);
  if (!words?.length) return null;
  const characterCount = words.reduce((total, word) => total + word.token.length, 0);
  const maximumDimension = Math.max(Number(page?.imageWidth) || 0, Number(page?.imageHeight) || 0);
  if (confidence < 0.7
    || median(confidences) < MIN_SPARSE_TEXT_CONFIDENCE
    || characterCount < MIN_SPARSE_TEXT_CHARS
    || totalBaseline < maximumDimension * MIN_SPARSE_ORIENTATION_BASELINE_RATIO
    || (acceptedWords < 2 && characterCount < 8)) return null;
  return {
    reliable: true,
    detectedDegrees,
    correctionDegrees: detectedDegrees,
    confidence,
    acceptedWords,
    words,
  };
}

function transformPoint(point, correctionDegrees, sourceWidth, sourceHeight) {
  if (correctionDegrees === 90) return { x: point.y, y: sourceWidth - point.x };
  if (correctionDegrees === 180) return { x: sourceWidth - point.x, y: sourceHeight - point.y };
  if (correctionDegrees === 270) return { x: sourceHeight - point.y, y: point.x };
  return point;
}

function uprightWords(page, correctionDegrees) {
  const sourceWidth = Number(page.imageWidth);
  const sourceHeight = Number(page.imageHeight);
  const upright = {
    ...page,
    imageWidth: correctionDegrees % 180 === 0 ? sourceWidth : sourceHeight,
    imageHeight: correctionDegrees % 180 === 0 ? sourceHeight : sourceWidth,
    words: page.words.map((word) => ({
      ...word,
      vertices: word.vertices.map((point) => (
        transformPoint(point, correctionDegrees, sourceWidth, sourceHeight)
      )),
    })),
  };
  return { page: upright, words: canonicalWords(upright) };
}

/**
 * The ordinary 0.70 orientation gate remains unchanged. Sparse final pages
 * may satisfy its evidence shortfall only when at least three independent
 * cardinal variants have >=0.70 dominance, strong OCR confidence, sufficient
 * baseline length and exact text/geometric agreement after correction.
 */
export function recoverSparseTailOrientationFromVariants(variantPages, {
  pageNumber,
  pageCount,
} = {}) {
  if (!isTailContext(pageNumber, pageCount)
    || !Array.isArray(variantPages)
    || variantPages.length !== 4) return null;
  const dimensions = commonDimensions(variantPages);
  if (!dimensions) return null;
  const seenRotations = new Set();
  const nonEmptySignatures = new Set();
  const qualified = [];
  for (let index = 0; index < variantPages.length; index += 1) {
    const page = variantPages[index];
    if (page?.pageNumber !== pageNumber
      || !Array.isArray(page?.words)
      || page.words.length > MAX_SPARSE_TAIL_WORDS
      || !Number.isSafeInteger(page?.recoveryRotationDegrees)
      || ![0, 90, 180, 270].includes(page.recoveryRotationDegrees)
      || seenRotations.has(page.recoveryRotationDegrees)) return null;
    seenRotations.add(page.recoveryRotationDegrees);
    const words = canonicalWords(page);
    if (words == null) return null;
    if (words.length > 0) nonEmptySignatures.add(tokenSignature(words));
    const orientation = sparseOrientationEvidence(page);
    if (orientation) qualified.push({ index, page, orientation });
  }
  if (nonEmptySignatures.size !== 1
    || qualified.length < MIN_ORIENTATION_VARIANT_CONSENSUS) return null;
  const correctionDegrees = qualified[0].orientation.correctionDegrees;
  if (qualified.some((candidate) => (
    candidate.orientation.correctionDegrees !== correctionDegrees
  ))) return null;
  const upright = qualified.map((candidate) => ({
    ...candidate,
    canonicalPage: candidate.page,
    ...uprightWords(candidate.page, correctionDegrees),
  }));
  const selected = [...upright].sort((left, right) => (
    right.orientation.acceptedWords - left.orientation.acceptedWords
      || right.orientation.confidence - left.orientation.confidence
      || left.index - right.index
  ))[0];
  if (!selected.words || upright.some((candidate) => (
    !candidate.words
      || tokenSignature(candidate.words) !== tokenSignature(selected.words)
      || !geometryAgrees(
        selected.words,
        candidate.words,
        selected.page.imageWidth,
        selected.page.imageHeight,
      )
  ))) return null;
  return {
    page: {
      ...selected.canonicalPage,
      recoveryProfile: "vision-sparse-tail-orientation-consensus-v1",
    },
    orientation: {
      reliable: true,
      detectedDegrees: correctionDegrees,
      correctionDegrees,
      confidence: Math.min(...upright.map((candidate) => candidate.orientation.confidence)),
      acceptedWords: Math.min(...upright.map((candidate) => candidate.orientation.acceptedWords)),
    },
  };
}
