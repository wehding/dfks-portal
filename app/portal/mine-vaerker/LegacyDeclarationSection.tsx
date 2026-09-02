import { fetchLegacyDeclarationTasks } from "@/app/actions/legacy-work-declarations";
import { LegacyDeclarationPanel } from "./LegacyDeclarationPanel";

export async function LegacyDeclarationSection() {
  const declarations = await fetchLegacyDeclarationTasks();
  return <LegacyDeclarationPanel
    initialTasks={declarations.tasks}
    enabled={declarations.enabled}
    cutoffYear={declarations.cutoffYear}
    organisationName={declarations.organisationName}
    document={declarations.document}
  />;
}
