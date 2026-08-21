export type WorkEditorView = "member" | "admin";

export type WorkEditorRelation = {
  primaryLabel: string;
  creditLabel: string | null;
  combinedLabel: string;
};

function comparable(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da") ?? "";
}

export function normalizeWorkEditorRole(
  role: string | null | undefined,
  defaultRole = "Klipper",
  coeditorWord = "Medklipper",
) {
  const trimmed = role?.trim();
  if (!trimmed) return defaultRole;
  const normalized = comparable(trimmed);
  if (normalized === "medklipper" || normalized === comparable(coeditorWord)) return defaultRole;
  if (normalized === comparable(defaultRole)) return defaultRole;
  if (normalized === "hovedklipper") return "Konceptuerende klipper";
  return trimmed;
}

export function resolveWorkEditorRelation(params: {
  view: WorkEditorView;
  isSelf?: boolean;
  editorCount: number;
  storedRole?: string | null;
  defaultRole?: string;
  coeditorWord?: string;
}): WorkEditorRelation {
  const defaultRole = params.defaultRole?.trim() || "Klipper";
  const coeditorWord = params.coeditorWord?.trim() || "Medklipper";
  const storedRole = normalizeWorkEditorRole(params.storedRole, defaultRole, coeditorWord);
  const primaryLabel = params.view === "member" && !params.isSelf && params.editorCount > 1
    ? coeditorWord
    : defaultRole;
  const creditLabel = comparable(storedRole) === comparable(defaultRole) ? null : storedRole;
  return {
    primaryLabel,
    creditLabel,
    combinedLabel: creditLabel ? `${primaryLabel} · ${creditLabel}` : primaryLabel,
  };
}
