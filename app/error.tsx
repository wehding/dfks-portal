"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Noget gik galt</h1>
        <p className="mt-2 max-w-md text-sm text-gray-500">
          Siden kunne ikke indlæses. Prøv igen, eller gå tilbage til forsiden.
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>
          Prøv igen
        </Button>
        <Button type="button" variant="outline" onClick={() => { window.location.href = "/"; }}>
          Til forsiden
        </Button>
      </div>
    </div>
  );
}
