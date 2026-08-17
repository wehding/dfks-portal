import { redirect } from "next/navigation";

export default async function LegacyValidationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const params = await searchParams;
  const id = typeof params.id === "string" && /^[0-9a-f-]{36}$/i.test(params.id)
    ? params.id
    : null;
  redirect(id
    ? `/admin/kontrakter?contract=${encodeURIComponent(id)}`
    : "/admin/kontrakter");
}
