import "server-only";

import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { detectWordFormat } from "@/lib/word-format";

export type DocxParagraph = {
    index: number    // 0-baseret afsnitsnummer
    text: string     // ren tekst uden HTML
    bold: boolean    // starter med fed tekst
    charStart: number // startindeks i flad sammenkædet tekst
    charEnd: number   // slutindeks
}

export type DocxLayout = {
    paragraphs: DocxParagraph[]
    flatText: string
}

/**
 * Ny funktion: udtræk DOCX-tekst MED layoutpositioner (afsnit + tegnindekser).
 * Eksisterende extractWordText() røres ikke.
 */
export async function extractWordTextWithLayout(buffer: Buffer, fileName = ""): Promise<DocxLayout> {
    const format = detectWordFormat(buffer, fileName)
    if (!format) throw new Error("Filen kunne ikke genkendes som et Word-dokument.")

    let rawHtml = ""
    if (format === "doc") {
        // .doc: ingen HTML-output — brug råtekst og lav ét afsnit per linje
        const document = await new WordExtractor().extract(buffer)
        const text = [document.getBody(), document.getHeaders(), document.getFootnotes(), document.getEndnotes()]
            .filter(Boolean).join("\n").trim()
        const lines = text.split("\n")
        let cursor = 0
        const paragraphs: DocxParagraph[] = []
        const parts: string[] = []
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i]
            paragraphs.push({ index: i, text: t, bold: false, charStart: cursor, charEnd: cursor + t.length })
            parts.push(t)
            cursor += t.length + 1 // +1 for \n
        }
        return { paragraphs, flatText: parts.join("\n") }
    }

    const result = await mammoth.convertToHtml({ buffer })
    rawHtml = result.value

    // Parse HTML-afsnit og strip tags
    const paragraphHtmls = rawHtml.split(/<\/p>|<\/h[1-6]>|<br\s*\/?>/).filter(Boolean)
    let cursor = 0
    const paragraphs: DocxParagraph[] = []
    const textParts: string[] = []

    for (let i = 0; i < paragraphHtmls.length; i++) {
        const html = paragraphHtmls[i]
        const bold = /<strong>|<b>/.test(html)
        // Strip alle HTML-tags
        const text = html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "").trim()
        if (!text) continue
        paragraphs.push({ index: i, text, bold, charStart: cursor, charEnd: cursor + text.length })
        textParts.push(text)
        cursor += text.length + 1
    }

    return { paragraphs, flatText: textParts.join("\n") }
}

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
