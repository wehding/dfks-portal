import { notFound } from "next/navigation";
import { fetchAdminContractEditorData } from "@/app/actions/member-contracts";
import { safeContractReturnTo } from "@/lib/contract-workbench";
import ContractWorkbenchClient, { type EditorData } from "./ContractWorkbenchClient";

export const dynamic = "force-dynamic";

export default async function ContractEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string; queueId?: string; section?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const result = await fetchAdminContractEditorData(id);
  if (!result.success) {
    if (result.error === "Kontrakten blev ikke fundet" || result.error === "Ikke autoriseret") notFound();
    throw new Error(`Kontraktarbejdsfladen kunne ikke indlæses: ${result.error}`);
  }
  return <ContractWorkbenchClient
    key={id}
    data={result as EditorData}
    returnTo={safeContractReturnTo(query.returnTo)}
    queueId={query.queueId ?? null}
    initialSection={query.section ?? null}
  />;
}
