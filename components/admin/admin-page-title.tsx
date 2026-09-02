"use client";

import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";

export const AdminPageTitleContext = createContext<Dispatch<SetStateAction<string | null>> | null>(null);

export function useAdminPageTitle(title: string | null) {
  const setPageTitle = useContext(AdminPageTitleContext);

  useEffect(() => {
    if (!setPageTitle) return;
    setPageTitle(title);
    return () => setPageTitle(null);
  }, [setPageTitle, title]);
}
