"use client";

import { useEffect } from "react";
import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarNavigationLink({ onClick, ...props }: LinkProps & Omit<React.ComponentProps<"a">, keyof LinkProps>) {
  const { setOpenMobile } = useSidebar();

  return <Link {...props} onClick={event => { setOpenMobile(false); onClick?.(event); }} />;
}

export function SidebarCloseOnNavigation() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  return null;
}
