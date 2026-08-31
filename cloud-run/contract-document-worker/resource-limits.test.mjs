import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DOCUMENT_PAGES,
  MAX_DOCUMENT_RASTER_BYTES,
  MAX_DOCUMENT_TOTAL_RASTER_BYTES,
  MAX_NATIVE_TEXT_BYTES_PER_PAGE,
  MAX_PDF_BBOX_BYTES,
  MAX_PDF_TEXT_BYTES,
  MAX_SPATIAL_GZIP_BYTES,
  MAX_SPATIAL_JSON_BYTES,
  MAX_VISION_RESPONSE_BYTES_PER_BATCH,
  MAX_VISION_RESPONSE_BYTES_TOTAL,
  MAX_VISION_WORDS_PER_PAGE,
  MAX_VISION_WORDS_TOTAL,
  resolveDocumentResourceLimits,
} from "./resource-limits.mjs";

test("produktionsgrænser kan strammes men aldrig hæves", () => {
  assert.deepEqual(resolveDocumentResourceLimits(), {
    maxDocumentPages: 200,
    maxDocumentRasterBytes: 64 * 1024 * 1024,
    maxDocumentTotalRasterBytes: 128 * 1024 * 1024,
    maxNativeTextBytesPerPage: MAX_NATIVE_TEXT_BYTES_PER_PAGE,
    maxPdfBboxBytes: MAX_PDF_BBOX_BYTES,
    maxPdfTextBytes: MAX_PDF_TEXT_BYTES,
    maxVisionWordsPerPage: MAX_VISION_WORDS_PER_PAGE,
    maxVisionWordsTotal: MAX_VISION_WORDS_TOTAL,
    maxSpatialJsonBytes: MAX_SPATIAL_JSON_BYTES,
    maxSpatialGzipBytes: MAX_SPATIAL_GZIP_BYTES,
    maxVisionResponseBytesPerBatch: MAX_VISION_RESPONSE_BYTES_PER_BATCH,
    maxVisionResponseBytesTotal: MAX_VISION_RESPONSE_BYTES_TOTAL,
  });
  assert.deepEqual(resolveDocumentResourceLimits({
    maxDocumentPages: MAX_DOCUMENT_PAGES + 1,
    maxDocumentRasterBytes: MAX_DOCUMENT_RASTER_BYTES + 1,
    maxDocumentTotalRasterBytes: MAX_DOCUMENT_TOTAL_RASTER_BYTES + 1,
  }), {
    maxDocumentPages: MAX_DOCUMENT_PAGES,
    maxDocumentRasterBytes: MAX_DOCUMENT_RASTER_BYTES,
    maxDocumentTotalRasterBytes: MAX_DOCUMENT_TOTAL_RASTER_BYTES,
    maxNativeTextBytesPerPage: MAX_NATIVE_TEXT_BYTES_PER_PAGE,
    maxPdfBboxBytes: MAX_PDF_BBOX_BYTES,
    maxPdfTextBytes: MAX_PDF_TEXT_BYTES,
    maxVisionWordsPerPage: MAX_VISION_WORDS_PER_PAGE,
    maxVisionWordsTotal: MAX_VISION_WORDS_TOTAL,
    maxSpatialJsonBytes: MAX_SPATIAL_JSON_BYTES,
    maxSpatialGzipBytes: MAX_SPATIAL_GZIP_BYTES,
    maxVisionResponseBytesPerBatch: MAX_VISION_RESPONSE_BYTES_PER_BATCH,
    maxVisionResponseBytesTotal: MAX_VISION_RESPONSE_BYTES_TOTAL,
  });
  assert.deepEqual(resolveDocumentResourceLimits({
    maxDocumentPages: 3,
    maxDocumentRasterBytes: 2_400,
    maxDocumentTotalRasterBytes: 4_800,
    maxNativeTextBytesPerPage: MAX_NATIVE_TEXT_BYTES_PER_PAGE,
    maxPdfBboxBytes: MAX_PDF_BBOX_BYTES,
    maxPdfTextBytes: MAX_PDF_TEXT_BYTES,
    maxVisionWordsPerPage: MAX_VISION_WORDS_PER_PAGE,
    maxVisionWordsTotal: MAX_VISION_WORDS_TOTAL,
    maxSpatialJsonBytes: MAX_SPATIAL_JSON_BYTES,
    maxSpatialGzipBytes: MAX_SPATIAL_GZIP_BYTES,
    maxVisionResponseBytesPerBatch: MAX_VISION_RESPONSE_BYTES_PER_BATCH,
    maxVisionResponseBytesTotal: MAX_VISION_RESPONSE_BYTES_TOTAL,
  }), {
    maxDocumentPages: 3,
    maxDocumentRasterBytes: 2_400,
    maxDocumentTotalRasterBytes: 4_800,
    maxNativeTextBytesPerPage: MAX_NATIVE_TEXT_BYTES_PER_PAGE,
    maxPdfBboxBytes: MAX_PDF_BBOX_BYTES,
    maxPdfTextBytes: MAX_PDF_TEXT_BYTES,
    maxVisionWordsPerPage: MAX_VISION_WORDS_PER_PAGE,
    maxVisionWordsTotal: MAX_VISION_WORDS_TOTAL,
    maxSpatialJsonBytes: MAX_SPATIAL_JSON_BYTES,
    maxSpatialGzipBytes: MAX_SPATIAL_GZIP_BYTES,
    maxVisionResponseBytesPerBatch: MAX_VISION_RESPONSE_BYTES_PER_BATCH,
    maxVisionResponseBytesTotal: MAX_VISION_RESPONSE_BYTES_TOTAL,
  });
  for (const invalid of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => resolveDocumentResourceLimits({ maxDocumentPages: invalid }), /invalid_resource_limit/);
  }
});
