"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{t("errors.genericTitle")}</h1>
        <p className="mt-2 max-w-md text-sm text-gray-500">
          {t("errors.genericDescription")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>
          {t("common.retry")}
        </Button>
        <Button type="button" variant="outline" onClick={() => { window.location.href = "/"; }}>
          {t("errors.toHome")}
        </Button>
      </div>
    </div>
  );
}
