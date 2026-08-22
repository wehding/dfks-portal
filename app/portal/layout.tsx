import { redirect } from "next/navigation";
import PortalShellClient from "@/components/portal/portal-shell-client";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const context = await getRequestAppAccessContext();
  if (!context) redirect("/");
  if (!context.canUseMember || !context.rightsHolderId) redirect(context.canUseAdmin ? "/admin" : "/");
  return <PortalShellClient initialContext={context}>{children}</PortalShellClient>;
}
