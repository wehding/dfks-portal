const COMPOUND_FILE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);

export type WordFormat = "doc" | "docx";

export function detectWordFormat(buffer: Buffer, fileName = ""): WordFormat | null {
  if (buffer.subarray(0, COMPOUND_FILE_MAGIC.length).equals(COMPOUND_FILE_MAGIC)) return "doc";
  if (buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) return "docx";

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".docx")) return "docx";
  if (lowerName.endsWith(".doc")) return "doc";
  return null;
}
