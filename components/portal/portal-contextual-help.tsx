"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help";
import { portalHelpForPath } from "@/lib/portal-help";

export function PortalContextualHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { section, content } = portalHelpForPath(pathname);

  return <>
    <HelpButton onClick={() => setOpen(current => !current)} className="h-9 w-auto shrink-0 gap-1 px-2 text-xs sm:h-8 sm:gap-2 sm:px-3 sm:text-sm" />
    <ContextualHelp
      {...content}
      open={open}
      onOpenChange={setOpen}
      storageKey={`dfks-portal-help-${section || "overblik"}-v1`}
      autoOpenOnFirstVisit
    />
  </>;
}
