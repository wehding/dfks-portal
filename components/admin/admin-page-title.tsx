"use client";

import { usePageMetadata } from "@/components/page-metadata";

export function useAdminPageTitle(title: string | null, subtitle: string | null = null) {
  usePageMetadata(title, subtitle);
}
