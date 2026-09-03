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
  pdfWidth?: number;
}) {
  const { containerWidth, containerHeight, boxWidth, boxHeight, pdfWidth } = input;
  if (![containerWidth, containerHeight, boxWidth, boxHeight].every(Number.isFinite) || containerWidth <= 0 || containerHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return 1;

  // Navnet/tekstboksen skal fylde ca. 2/3 af skærmområdets bredde
  const targetWidth = containerWidth * (2 / 3);
  const targetHeight = containerHeight * 0.45;
  const widthScale = targetWidth / Math.max(1, boxWidth);
  const heightScale = targetHeight / Math.max(1, boxHeight);

  // Vælg skala så boksen fylder 2/3 af bredden, men begrænset hvis højden er for stor
  const idealScale = Math.min(widthScale, heightScale);

  // Basisskala for at tilpasse til bredden
  const fitWidth = pdfWidth && pdfWidth > 0 ? calculatePdfFitWidthScale(containerWidth, pdfWidth, 16) : 0.6;

  // Skalaen må aldrig blive mindre end fitWidth, og maks 2.4
  return Math.max(fitWidth, Math.min(2.4, idealScale));
}

