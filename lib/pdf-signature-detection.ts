export type PdfSignatureMethod = "handwritten" | "digital" | "unknown";

export type PdfSignatureIndicators = {
  hasCryptographicSignature: boolean;
  hasSignatureWidget: boolean;
  digitalSignatureTextPage: number | null;
  handwrittenPathPage: number | null;
};

export type PdfSignatureDetection = {
  status: "yes" | "unknown";
  method: PdfSignatureMethod;
  page: number | null;
  evidence: string | null;
};

export function classifyPdfSignatureIndicators(indicators: PdfSignatureIndicators): PdfSignatureDetection {
  if (indicators.hasCryptographicSignature || indicators.hasSignatureWidget || indicators.digitalSignatureTextPage) {
    return {
      status: "yes",
      method: "digital",
      page: indicators.digitalSignatureTextPage,
      evidence: "Digital underskrift registreret lokalt i PDF'en.",
    };
  }
  if (indicators.handwrittenPathPage) {
    return {
      status: "yes",
      method: "handwritten",
      page: indicators.handwrittenPathPage,
      evidence: `Håndskrevet underskrift registreret lokalt på side ${indicators.handwrittenPathPage}.`,
    };
  }
  return { status: "unknown", method: "unknown", page: null, evidence: null };
}

function numericArrays(value: unknown): number[][] {
  if (ArrayBuffer.isView(value)) return [Array.from(value as unknown as ArrayLike<number>)];
  if (!Array.isArray(value)) return [];
  if (value.every(item => typeof item === "number")) return [value as number[]];
  return value.flatMap(numericArrays);
}

function likelyHandwrittenPath(args: unknown, pageWidth: number, pageHeight: number) {
  const arrays = numericArrays(args);
  const complexCoordinates = arrays.some(values => values.length >= 36);
  if (!complexCoordinates) return false;
  return arrays.some(values => {
    if (values.length !== 4) return false;
    const [x1, y1, x2, y2] = values;
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    const lowerPage = Math.min(y1, y2) <= pageHeight * 0.68;
    return lowerPage && width >= 35 && width <= pageWidth * 0.7 && height >= 4 && height <= pageHeight * 0.15 && width / height >= 1.4;
  });
}

export async function detectPdfSignature(buffer: Buffer): Promise<PdfSignatureDetection> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const indicators: PdfSignatureIndicators = {
    hasCryptographicSignature: buffer.includes(Buffer.from("/ByteRange")) || buffer.includes(Buffer.from("/Type /Sig")),
    hasSignatureWidget: false,
    digitalSignatureTextPage: null,
    handwrittenPathPage: null,
  };

  const firstPage = Math.max(1, document.numPages - 1);
  for (let pageNumber = firstPage; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const annotations = await page.getAnnotations();
    if (annotations.some(annotation => annotation.fieldType === "Sig" || annotation.subtype === "Signature")) {
      indicators.hasSignatureWidget = true;
    }

    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map(item => "str" in item ? item.str : "")
      .join(" ")
      .toLocaleLowerCase("da");
    if (/(digitalt|elektronisk)\s+(underskrevet|signeret)|penneo|docusign|adobe sign|signeret med mitid/.test(pageText)) {
      indicators.digitalSignatureTextPage = pageNumber;
    }

    const operatorList = await page.getOperatorList();
    const pageWidth = Math.abs(page.view[2] - page.view[0]);
    const pageHeight = Math.abs(page.view[3] - page.view[1]);
    for (let index = 0; index < operatorList.fnArray.length; index += 1) {
      if (operatorList.fnArray[index] !== pdfjs.OPS.constructPath) continue;
      if (likelyHandwrittenPath(operatorList.argsArray[index], pageWidth, pageHeight)) {
        indicators.handwrittenPathPage = pageNumber;
        break;
      }
    }
  }

  return classifyPdfSignatureIndicators(indicators);
}
