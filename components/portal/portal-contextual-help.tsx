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
    <HelpButton onClick={() => setOpen(true)} className="h-9 w-9 px-0 sm:h-8 sm:w-auto sm:px-3" />
    <ContextualHelp
      {...content}
      open={open}
      onOpenChange={setOpen}
      storageKey={`dfks-portal-help-${section || "overblik"}-v1`}
    />
  </>;
}
