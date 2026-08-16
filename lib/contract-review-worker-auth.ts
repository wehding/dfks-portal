export function isContractReviewWorkerAuthorized(input: {
  method: "GET" | "POST";
  authorization: string | null;
  cronSecret?: string | null;
  workerSecret?: string | null;
}) {
  if (!input.authorization?.startsWith("Bearer ")) return false;
  const supplied = input.authorization.slice("Bearer ".length);
  const expected = input.method === "GET" ? input.cronSecret : input.workerSecret;
  return Boolean(expected && supplied === expected);
}
