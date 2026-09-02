"use client";

import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";

export type AppPageMetadata = { title: string | null; subtitle: string | null };
export const EMPTY_PAGE_METADATA: AppPageMetadata = { title: null, subtitle: null };
export const PageMetadataContext = createContext<Dispatch<SetStateAction<AppPageMetadata>> | null>(null);

export function usePageMetadata(title: string | null, subtitle: string | null = null) {
  const setMetadata = useContext(PageMetadataContext);
  useEffect(() => {
    if (!setMetadata) return;
    setMetadata({ title, subtitle });
    return () => setMetadata(current => current.title === title && current.subtitle === subtitle ? EMPTY_PAGE_METADATA : current);
  }, [setMetadata, subtitle, title]);
}
