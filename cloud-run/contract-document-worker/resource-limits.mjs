export const MAX_DOCUMENT_PAGES = 200;
export const MAX_DOCUMENT_RASTER_BYTES = 64 * 1024 * 1024;
export const MAX_DOCUMENT_TOTAL_RASTER_BYTES = 128 * 1024 * 1024;
export const MAX_NATIVE_TEXT_BYTES_PER_PAGE = 2 * 1024 * 1024;
export const MAX_PDF_BBOX_BYTES = 64 * 1024 * 1024;
export const MAX_PDF_TEXT_BYTES = 32 * 1024 * 1024;
export const MAX_VISION_WORDS_PER_PAGE = 25_000;
export const MAX_VISION_WORDS_TOTAL = 250_000;
export const MAX_SPATIAL_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_SPATIAL_GZIP_BYTES = 25 * 1024 * 1024;
export const MAX_VISION_RESPONSE_BYTES_PER_BATCH = 16 * 1024 * 1024;
export const MAX_VISION_RESPONSE_BYTES_TOTAL = 64 * 1024 * 1024;
export const MAX_VISION_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

function tightenedPositiveInteger(value, productionMaximum) {
  if (value == null) return productionMaximum;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("invalid_resource_limit");
  return Math.min(value, productionMaximum);
}

/**
 * Test and specialised callers may only tighten production limits. A future
 * caller cannot accidentally raise Cloud Run's fail-closed memory boundary.
 */
export function resolveDocumentResourceLimits(overrides = {}) {
  return {
    maxDocumentPages: tightenedPositiveInteger(overrides.maxDocumentPages, MAX_DOCUMENT_PAGES),
    maxDocumentRasterBytes: tightenedPositiveInteger(
      overrides.maxDocumentRasterBytes,
      MAX_DOCUMENT_RASTER_BYTES,
    ),
    maxDocumentTotalRasterBytes: tightenedPositiveInteger(
      overrides.maxDocumentTotalRasterBytes,
      MAX_DOCUMENT_TOTAL_RASTER_BYTES,
    ),
    maxNativeTextBytesPerPage: tightenedPositiveInteger(
      overrides.maxNativeTextBytesPerPage,
      MAX_NATIVE_TEXT_BYTES_PER_PAGE,
    ),
    maxPdfBboxBytes: tightenedPositiveInteger(overrides.maxPdfBboxBytes, MAX_PDF_BBOX_BYTES),
    maxPdfTextBytes: tightenedPositiveInteger(overrides.maxPdfTextBytes, MAX_PDF_TEXT_BYTES),
    maxVisionWordsPerPage: tightenedPositiveInteger(
      overrides.maxVisionWordsPerPage,
      MAX_VISION_WORDS_PER_PAGE,
    ),
    maxVisionWordsTotal: tightenedPositiveInteger(
      overrides.maxVisionWordsTotal,
      MAX_VISION_WORDS_TOTAL,
    ),
    maxSpatialJsonBytes: tightenedPositiveInteger(
      overrides.maxSpatialJsonBytes,
      MAX_SPATIAL_JSON_BYTES,
    ),
    maxSpatialGzipBytes: tightenedPositiveInteger(
      overrides.maxSpatialGzipBytes,
      MAX_SPATIAL_GZIP_BYTES,
    ),
    maxVisionResponseBytesPerBatch: tightenedPositiveInteger(
      overrides.maxVisionResponseBytesPerBatch,
      MAX_VISION_RESPONSE_BYTES_PER_BATCH,
    ),
    maxVisionResponseBytesTotal: tightenedPositiveInteger(
      overrides.maxVisionResponseBytesTotal,
      MAX_VISION_RESPONSE_BYTES_TOTAL,
    ),
    maxVisionRequestBodyBytes: tightenedPositiveInteger(
      overrides.maxVisionRequestBodyBytes,
      MAX_VISION_REQUEST_BODY_BYTES,
    ),
  };
}
