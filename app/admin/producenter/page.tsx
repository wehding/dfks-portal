import ProducerListClient, { type ProducerListInitialData } from "./producer-list-client";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { loadAdminProducerList } from "@/lib/server/admin-producer-list";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProducersPage({ searchParams }: PageProps) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["query", "status", "associationGroup", "producerType", "rightsHolderId", "sort", "direction", "page", "pageSize"]) {
    const value = values[key];
    if (typeof value === "string") query.set(key, value);
  }
  const access = await getRequestAppAccessContext();
  const initialData = access?.canUseAdmin && access.role && access.modules?.producers.read
    ? await loadAdminProducerList({ orgId: access.orgId, role: access.role }, query).catch(() => undefined) as ProducerListInitialData | undefined
    : undefined;
  return <ProducerListClient initialData={initialData} />;
}
