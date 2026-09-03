const PDF_MAGIC = Buffer.from("%PDF-", "ascii");
const DOC_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC_PREFIXES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

function startsWith(bytes, magic) {
  return bytes.length >= magic.length && bytes.subarray(0, magic.length).equals(magic);
}

export function detectContractSourceFormat(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, DOC_MAGIC)) return "doc";
  if (ZIP_MAGIC_PREFIXES.some((magic) => startsWith(bytes, magic))) return "docx";
  return null;
}

export function contractSourceFormatFromPath(path) {
  const match = String(path ?? "").split(/[?#]/, 1)[0].match(/\.([a-z0-9]+)$/i);
  const extension = match?.[1]?.toLocaleLowerCase("en-US") ?? "";
  return ["pdf", "doc", "docx"].includes(extension) ? extension : null;
}
