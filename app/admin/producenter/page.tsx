import { NextRequest } from "next/server";
import ProducerListClient, { type ProducerListInitialData } from "./producer-list-client";
import { GET as getProducers } from "@/app/api/admin/producers/route";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProducersPage({ searchParams }: PageProps) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["query", "status", "associationGroup", "producerType", "rightsHolderId", "sort", "direction", "page", "pageSize"]) {
    const value = values[key];
    if (typeof value === "string") query.set(key, value);
  }
  const response = await getProducers(new NextRequest(`http://internal/api/admin/producers?${query}`));
  const initialData = response.ok ? await response.json() as ProducerListInitialData : undefined;
  return <ProducerListClient initialData={initialData} />;
}
