"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help";
import { adminHelpForPath } from "@/lib/admin-help";

export function AdminContextualHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { section, content } = adminHelpForPath(pathname);
  const pageOwnsFirstVisitHelp = section === "kontrakter" || section === "vaerker";
  return <>
    <HelpButton onClick={() => setOpen(true)} className="h-8 w-auto px-2 sm:px-3" />
    <ContextualHelp
      {...content}
      open={open}
      onOpenChange={setOpen}
      storageKey={pageOwnsFirstVisitHelp ? undefined : `dfks-admin-help-${section || "overblik"}-v1`}
    />
  </>;
}
