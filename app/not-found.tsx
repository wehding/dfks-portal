"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{t("errors.notFoundTitle")}</h1>
        <p className="mt-2 max-w-md text-sm text-gray-500">
          {t("errors.notFoundDescription")}
        </p>
      </div>
      <Button asChild>
        <Link href="/">{t("errors.toHome")}</Link>
      </Button>
    </div>
  );
}
