/**
 * lib/mask-text.ts
 *
 * Masks personal data before sending contract text to AI.
 * Used by both the extract API route and the validering screening flow.
 */

export function maskPersonalData(text: string): string {
    return text
        .replace(/\b\d{6}\s*[-–]\s*\d{4}\b/g, "[CPR-NUMMER]")
        .replace(/\b\d{4}[\s-]\d{6,10}\b/g, "[KONTONUMMER]")
        .replace(/\b[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){3,6}\d{1,4}\b/g, "[IBAN]")
        .replace(/(?:\+45[\s-]?)?\b(?:\d{2}[\s-]){3}\d{2}\b/g, "[TELEFON]")
        .replace(/\b\d{8}\b(?!\s*(?:kr|dkk|,-|%|uger|timer|moms))/gi, "[TELEFON]")
        .replace(/\b[A-ZÆØÅa-zæøå0-9._%+\-]+@[A-ZÆØÅa-zæøå0-9.\-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]")
        .replace(/\b[A-ZÆØÅ][a-zæøå]+(?:vej|gade|alle|allé|stræde|plads|vænge|torv|have|park|skov|mark)\s+\d+[A-Za-z]?(?:,?\s*\d{1,2}\.?\s*(?:th|tv|mf|sal)?)?\b/gi, "[ADRESSE]")
        .replace(/\b\d{4}\s+[A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+)?\b/g, "[POSTNR-BY]")
        .replace(/\b(?:cvr\.?(?:[-–\s]?nr\.?)?\s*:?\s*)\d{8}\b/gi, "CVR: [CVR-NUMMER]")
}
