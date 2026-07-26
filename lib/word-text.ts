import "server-only";

import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { detectWordFormat } from "@/lib/word-format";

export async function extractWordText(buffer: Buffer, fileName = ""): Promise<string> {
  const format = detectWordFormat(buffer, fileName);
  if (!format) throw new Error("Filen kunne ikke genkendes som et Word-dokument.");

  try {
    if (format === "doc") {
      const document = await new WordExtractor().extract(buffer);
      const text = [document.getBody(), document.getHeaders(), document.getFootnotes(), document.getEndnotes()]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) throw new Error("Dokumentet indeholder ingen læsbar tekst.");
      return text;
    }

    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (!text) throw new Error("Dokumentet indeholder ingen læsbar tekst.");
    return text;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "ukendt parserfejl";
    throw new Error(`Word-dokumentet kunne ikke læses (${format.toUpperCase()}): ${detail}`);
  }
}
