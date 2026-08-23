"use client";

import dynamic from "next/dynamic";
import { Suspense, useState } from "react";
import { ChevronDown, Upload } from "lucide-react";
import { ContractReviewQueue, type ContractReviewQueueInitialData } from "./review-queue";
import { PageHeader } from "@/components/page-header";
import { Separator } from "@/components/ui/separator";

const ManualContractReview = dynamic(
  () => import("./manual-contract-review").then(module => module.ManuelGennemgang),
  { loading: () => <div className="h-48 animate-pulse rounded-lg bg-muted" /> },
);

export default function ContractReviewPageClient({ initialData }: { initialData?: ContractReviewQueueInitialData }) {
  const [showManual, setShowManual] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader title="Kontraktgennemgang" subtitle="Juridisk gennemgang og feedback på foreløbige kontrakter" />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
        <ContractReviewQueue initialData={initialData} />
      </Suspense>
      <div className="space-y-4">
        <Separator />
        <button
          type="button"
          onClick={() => setShowManual(value => !value)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Upload className="h-4 w-4" />
          Upload og analyser kontrakt manuelt
          <ChevronDown className={`h-4 w-4 transition-transform ${showManual ? "rotate-180" : ""}`} />
        </button>
        {showManual && <ManualContractReview />}
      </div>
    </div>
  );
}
