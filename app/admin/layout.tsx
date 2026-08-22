import { redirect } from "next/navigation";
import AdminShellClient from "@/components/admin/admin-shell-client";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await getRequestAppAccessContext();
  if (!context) redirect("/");
  if (!context.canUseAdmin || !context.role) redirect(context.canUseMember ? "/portal" : "/");
  return <AdminShellClient initialContext={context}>{children}</AdminShellClient>;
}
