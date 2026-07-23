export type ProducerStatus = "attention" | "active" | "inactive";

export function resolveProducerStatus(contractStatuses: readonly string[], workCount: number): ProducerStatus {
  if (contractStatuses.includes("kladde")) return "attention";
  if (contractStatuses.length > 0 || workCount > 0) return "active";
  return "inactive";
}
