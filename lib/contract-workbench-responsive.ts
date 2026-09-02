export const CONTRACT_WORKBENCH_SPLIT_MIN_WIDTH = 760;
export const CONTRACT_WORKBENCH_SPLIT_QUERY = `(min-width: ${CONTRACT_WORKBENCH_SPLIT_MIN_WIDTH}px)`;

export function usesContractWorkbenchSplitLayout(viewportWidth: number) {
  return viewportWidth >= CONTRACT_WORKBENCH_SPLIT_MIN_WIDTH;
}

export function calculatePdfFitWidthScale(containerWidth: number, pdfWidth: number, padding = 32) {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(pdfWidth) || pdfWidth <= 0) return 1;
  const availableWidth = Math.max(160, containerWidth - padding);
  return Math.min(1, Math.max(0.25, availableWidth / pdfWidth));
}

export function calculatePdfEvidenceScale(input: {
  containerWidth: number;
  containerHeight: number;
  boxWidth: number;
  boxHeight: number;
}) {
  const { containerWidth, containerHeight, boxWidth, boxHeight } = input;
  if (![containerWidth, containerHeight, boxWidth, boxHeight].every(Number.isFinite) || containerWidth <= 0 || containerHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return 1;
  const availableWidth = Math.max(200, containerWidth * 0.72);
  const availableHeight = Math.max(160, containerHeight * 0.48);
  const paddedWidth = Math.max(1, boxWidth * 1.5);
  const paddedHeight = Math.max(1, boxHeight * 2.2);
  return Math.max(0.4, Math.min(1.35, availableWidth / paddedWidth, availableHeight / paddedHeight));
}
