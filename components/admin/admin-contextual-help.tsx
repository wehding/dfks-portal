"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help";
import { adminHelpForPath } from "@/lib/admin-help";

export function AdminContextualHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { section, content } = adminHelpForPath(pathname);
  return <>
    <HelpButton onClick={() => setOpen(true)} className="h-9 w-auto shrink-0 gap-1 px-2 text-xs sm:h-8 sm:gap-2 sm:px-3 sm:text-sm" />
    <ContextualHelp
      {...content}
      open={open}
      onOpenChange={setOpen}
      storageKey={`dfks-admin-help-${section || "overblik"}-v1`}
    />
  </>;
}
