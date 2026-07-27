export type ProducerStatus = "attention" | "active" | "inactive";
export type ProducerAssociationStatus = "ordinary" | "associate" | "unknown" | "none";

export function resolveProducerAssociationStatus(types: readonly string[]): ProducerAssociationStatus {
  if (types.includes("ordinary")) return "ordinary";
  if (types.includes("associate")) return "associate";
  if (types.length) return "unknown";
  return "none";
}

export function producerAssociationLabel(status: ProducerAssociationStatus) {
  if (status === "ordinary") return "Medlem af Producentforeningen";
  if (status === "associate") return "Associeret medlem af Producentforeningen";
  if (status === "unknown") return "Medlemsstatus ikke klassificeret";
  return "Ikke medlem af Producentforeningen";
}

export type CvrLegalEntityDraft = {
  id?: string;
  registrationNumber: string;
  isPrimary: boolean;
};

export function resolveProducerStatus(contractStatuses: readonly string[], workCount: number): ProducerStatus {
  if (contractStatuses.includes("kladde")) return "attention";
  if (contractStatuses.length > 0 || workCount > 0) return "active";
  return "inactive";
}

function normalizedCvr(value: string) {
  return value.replace(/\D/g, "");
}

export function mergeCvrLegalEntity<T extends CvrLegalEntityDraft>(rows: readonly T[], incoming: T): T[] {
  const incomingCvr = normalizedCvr(incoming.registrationNumber);
  const matchingIndex = incomingCvr
    ? rows.findIndex(row => normalizedCvr(row.registrationNumber) === incomingCvr)
    : -1;
  const reusableIndex = rows.findIndex(row => !normalizedCvr(row.registrationNumber));
  const targetIndex = matchingIndex >= 0 ? matchingIndex : reusableIndex;

  if (targetIndex >= 0) {
    return rows.map((row, index) => index === targetIndex
      ? { ...row, ...incoming, id: row.id, isPrimary: row.isPrimary }
      : row);
  }

  return [...rows, { ...incoming, isPrimary: rows.length === 0 }];
}
