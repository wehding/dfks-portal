export type InboxRecipient = {
  id: string;
  full_name: string;
  email: string | null;
};

function normalizeRecipientSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterInboxRecipients(recipients: InboxRecipient[], query: string) {
  const needle = normalizeRecipientSearch(query);
  if (!needle) return recipients;
  return recipients.filter(recipient => normalizeRecipientSearch(
    `${recipient.full_name} ${recipient.email ?? ""}`,
  ).includes(needle));
}

export function selectVisibleRecipientIds(selectedIds: string[], visibleIds: string[]) {
  return [...new Set([...selectedIds, ...visibleIds])];
}
