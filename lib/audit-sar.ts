import "server-only";

import { createHash, createHmac } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { csvAuditCell, type AuditEvent } from "@/lib/audit-log";

export type SubjectAccessEvent = {
  eventId: string;
  timestamp: string;
  action: string;
  purpose: string;
  legalBasis: string | null;
  actor: string;
  actorRole: string | null;
  systemComponent: string;
  dataCategories: string[];
  outcome: string;
};

function pseudonymForIndex(index: number): string {
  let value = index;
  let suffix = "";
  do {
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return `[SAGSBEHANDLER_${suffix}]`;
}

export function buildStaffPseudonyms(events: readonly AuditEvent[], requestId: string): Map<string, string> {
  const actorIds = [...new Set(events.map(event => event.actorUserId).filter((value): value is string => Boolean(value)))];
  actorIds.sort((left, right) => {
    const leftHash = createHmac("sha256", requestId).update(left).digest("hex");
    const rightHash = createHmac("sha256", requestId).update(right).digest("hex");
    return leftHash.localeCompare(rightHash);
  });
  return new Map(actorIds.map((actorId, index) => [actorId, pseudonymForIndex(index)]));
}

export function subjectAccessEvents(
  events: readonly AuditEvent[],
  requestId: string,
  maskStaffNames = true,
): SubjectAccessEvent[] {
  const pseudonyms = buildStaffPseudonyms(events, requestId);
  return events.map(event => ({
    eventId: event.id,
    timestamp: event.occurredAt,
    action: event.action,
    purpose: event.purposeCode ?? "ikke_angivet",
    legalBasis: event.legalBasis,
    actor: event.actorRole === "member"
      ? "[MEDLEM]"
      : event.actorType !== "user"
      ? event.actorType === "integration" ? "[INTEGRATION]" : "[SYSTEM]"
      : maskStaffNames
        ? pseudonyms.get(event.actorUserId ?? "") ?? "[SAGSBEHANDLER]"
        : event.actorDisplayName ?? "[SAGSBEHANDLER]",
    actorRole: event.actorRole,
    systemComponent: event.systemComponent ?? event.source,
    dataCategories: event.dataCategories,
    outcome: event.outcome,
  }));
}

export function subjectAccessJson(events: readonly SubjectAccessEvent[]): Uint8Array {
  return Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), events }, null, 2), "utf8");
}

export function subjectAccessCsv(events: readonly SubjectAccessEvent[]): Uint8Array {
  const header = ["Hændelses-id", "Tidspunkt", "Handling", "Formål", "Retsgrundlag", "Aktør", "Rolle", "Systemkomponent", "Datakategorier", "Resultat"];
  const rows = events.map(event => [
    event.eventId, event.timestamp, event.action, event.purpose, event.legalBasis ?? "",
    event.actor, event.actorRole ?? "", event.systemComponent, event.dataCategories.join(" | "), event.outcome,
  ]);
  return Buffer.from(`\uFEFF${[header, ...rows].map(row => row.map(csvAuditCell).join(";")).join("\r\n")}`, "utf8");
}

function wrapPdfText(value: string, maxLength = 95): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export async function subjectAccessPdf(events: readonly SubjectAccessEvent[], memberLabel: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595.28, 841.89]);
  let y = 800;
  const draw = (text: string, size = 9, isBold = false) => {
    if (y < 55) { page = document.addPage([595.28, 841.89]); y = 800; }
    page.drawText(text, { x: 42, y, size, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 5;
  };
  draw("Indsigtsrapport – behandling af medlemsdata", 16, true);
  draw(`Medlem: ${memberLabel}`, 10, true);
  draw(`Genereret: ${new Date().toISOString()}`, 9);
  y -= 8;
  if (!events.length) draw("Der er ingen registrerede hændelser i den valgte periode.");
  for (const event of events) {
    draw(`${event.timestamp} · ${event.action} · ${event.outcome}`, 9, true);
    const detail = `Formål: ${event.purpose}. Aktør: ${event.actor}${event.actorRole ? ` (${event.actorRole})` : ""}. Komponent: ${event.systemComponent}. Data: ${event.dataCategories.join(", ") || "ikke angivet"}.`;
    for (const line of wrapPdfText(detail)) draw(line, 8);
    y -= 5;
  }
  return document.save();
}

export function contentSha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
