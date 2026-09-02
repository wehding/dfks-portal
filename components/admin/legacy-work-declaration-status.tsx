"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { fetchAdminLegacyDeclarationsForWork, invalidateLegacyDeclaration } from "@/app/actions/legacy-work-declarations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Declaration = Awaited<ReturnType<typeof fetchAdminLegacyDeclarationsForWork>>[number];

export function LegacyWorkDeclarationStatus({ workId }: { workId: string }) {
  const [rows, setRows] = useState<Declaration[] | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void fetchAdminLegacyDeclarationsForWork(workId)
      .then(result => { if (active) setRows(result); })
      .catch(error => { if (active) toast.error(error instanceof Error ? error.message : "Erklæringer kunne ikke hentes."); });
    return () => { active = false; };
  }, [workId]);

  if (rows === null) return <p className="text-sm text-muted-foreground">Henter tro-og-loveerklæringer…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Ingen tro-og-loveerklæringer er registreret for værket.</p>;

  function invalidate(row: Declaration) {
    const reason = window.prompt("Angiv den obligatoriske begrundelse for ugyldiggørelsen:");
    if (!reason?.trim()) return;
    startTransition(async () => {
      try {
        await invalidateLegacyDeclaration({ declarationId: row.id, reason });
        setRows(current => current?.map(item => item.id === row.id ? { ...item, invalidatedAt: new Date().toISOString(), invalidationReason: reason.trim() } : item) ?? []);
        toast.success("Erklæringen er ugyldiggjort");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erklæringen kunne ikke ugyldiggøres.");
      }
    });
  }

  return <div className="space-y-2">
    {rows.map(row => <div key={row.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{row.rightsHolderName}</p>
        <p className="text-xs text-muted-foreground">Version {row.documentVersion} · {new Date(row.acceptedAt).toLocaleString("da-DK")}</p>
        {row.invalidationReason && <p className="mt-1 text-xs text-muted-foreground">Begrundelse registreret</p>}
      </div>
      {row.invalidatedAt ? <Badge variant="outline">Ugyldiggjort</Badge> : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => invalidate(row)}>Ugyldiggør</Button>}
    </div>)}
  </div>;
}
