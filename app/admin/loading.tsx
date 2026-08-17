"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";

export default function AdminLoading() {
  const { t } = useI18n();
  return (
    <main className="space-y-5 p-4 sm:p-6" aria-busy="true" aria-label={t("admin.loading")}>
      <Skeleton className="h-9 w-56 max-w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24" />)}
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
      </div>
    </main>
  );
}
