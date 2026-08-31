const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeaseArtifactPathsInput = {
  orgId: string;
  contractId: string;
  leaseToken?: string | null;
  outputStoragePath?: string | null;
  spatialDataPath?: string | null;
  promotedPdfPath?: string | null;
  promotedSpatialPath?: string | null;
};

export function parseContractDocumentLeaseArtifactPath(path: string) {
  const parts = path.split("/");
  if (parts.length !== 6
    || !UUID_PATTERN.test(parts[0] ?? "")
    || parts[1] !== "processed"
    || !UUID_PATTERN.test(parts[2] ?? "")
    || parts[3] !== "leases"
    || !UUID_PATTERN.test(parts[4] ?? "")
    || !["normalised.pdf", "vision-layout.json.gz"].includes(parts[5] ?? "")) {
    return null;
  }
  return {
    orgId: parts[0],
    contractId: parts[2],
    leaseToken: parts[4],
    filename: parts[5] as "normalised.pdf" | "vision-layout.json.gz",
  };
}

function isExpectedLeaseArtifact(
  path: string,
  orgId: string,
  contractId: string,
  filename: "normalised.pdf" | "vision-layout.json.gz",
  leaseToken?: string | null,
) {
  const parsed = parseContractDocumentLeaseArtifactPath(path);
  return parsed?.orgId === orgId
    && parsed.contractId === contractId
    && parsed.filename === filename
    && (!leaseToken || parsed.leaseToken === leaseToken);
}

/**
 * Returns only derivative paths that are scoped to the expected organisation,
 * contract and immutable lease namespace. Promoted derivatives are excluded.
 * The legal source path can therefore never be selected for cleanup.
 */
export function getRemovableLeaseArtifactPaths(input: LeaseArtifactPathsInput) {
  const paths: string[] = [];
  if (input.outputStoragePath
    && input.outputStoragePath !== input.promotedPdfPath
    && isExpectedLeaseArtifact(
      input.outputStoragePath,
      input.orgId,
      input.contractId,
      "normalised.pdf",
      input.leaseToken,
    )) {
    paths.push(input.outputStoragePath);
  }
  if (input.spatialDataPath
    && input.spatialDataPath !== input.promotedSpatialPath
    && isExpectedLeaseArtifact(
      input.spatialDataPath,
      input.orgId,
      input.contractId,
      "vision-layout.json.gz",
      input.leaseToken,
    )) {
    paths.push(input.spatialDataPath);
  }
  return paths;
}
