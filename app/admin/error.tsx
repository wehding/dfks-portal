"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error("[admin-page] render failed", error.digest ?? error.name);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <h1 className="text-xl font-semibold">{t("admin.error.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("admin.error.description")}</p>
      <Button type="button" onClick={reset}>{t("admin.error.retry")}</Button>
    </main>
  );
}
