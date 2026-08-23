import { maskPersonalData } from "@/lib/mask-text";
import type { ContractReviewThreadMessage } from "@/lib/gmail-contract-thread";

export const MAX_REVIEW_MAIL_CONTEXT_CHARS = 50_000;

function renderMessage(message: ContractReviewThreadMessage) {
  return maskPersonalData([
    `Tidspunkt: ${message.receivedAt ?? "ukendt"}`,
    `Retning: ${message.direction === "outgoing" ? "fra DFKS" : "til DFKS"}`,
    `Fra: ${message.from ?? "ukendt"}`,
    `Til: ${message.to.join(", ") || "ukendt"}`,
    message.cc.length ? `Cc: ${message.cc.join(", ")}` : null,
    `Emne: ${message.subject ?? "uden emne"}`,
    "Mailtekst:",
    message.body ?? "[ingen læsbar tekst]",
  ].filter(Boolean).join("\n"));
}

export function buildMaskedReviewMailContext(messages: ContractReviewThreadMessage[], maximum = MAX_REVIEW_MAIL_CONTEXT_CHARS) {
  const rendered = messages.map(renderMessage);
  if (rendered.join("\n\n---\n\n").length <= maximum) return rendered.join("\n\n---\n\n");
  const firstBudget = Math.floor(maximum * 0.3);
  const first = rendered[0]?.slice(0, firstBudget) ?? "";
  const newest: string[] = [];
  let used = first.length + 80;
  for (let index = rendered.length - 1; index >= 1; index -= 1) {
    const remaining = maximum - used;
    if (remaining <= 0) break;
    newest.unshift(rendered[index].slice(0, remaining));
    used += Math.min(rendered[index].length, remaining) + 9;
  }
  return `${first}\n\n[ÆLDRE MELLEMLIGGENDE BESKEDER ER FORKORTET]\n\n${newest.join("\n\n---\n\n")}`.slice(0, maximum);
}

export function latestThreadMessageId(messages: ContractReviewThreadMessage[]): string | null {
  return messages.at(-1)?.gmailMessageId ?? null;
}
