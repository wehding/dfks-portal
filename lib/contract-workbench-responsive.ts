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
