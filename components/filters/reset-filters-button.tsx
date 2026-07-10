"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ResetFiltersButton({ active, onReset }: { active: boolean; onReset: () => void }) {
  return (
    <Button type="button" variant="ghost" className="w-full gap-2 sm:w-auto" onClick={onReset} disabled={!active}>
      <RotateCcw className="h-4 w-4" />
      Nulstil filter
    </Button>
  );
}
