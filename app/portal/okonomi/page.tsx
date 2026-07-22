"use client";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, Clock, Wrench } from "lucide-react";

export default function PortalOkonomiPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Økonomi & Udbetalinger"
        subtitle="Oversigt over dine royalty-udbetalinger, fordelingsnøgler og Copydan-midler."
      />

      <Card className="border-amber-200/80 bg-gradient-to-br from-amber-50/50 via-background to-background dark:border-amber-900/40 dark:from-amber-950/20">
        <CardHeader className="text-center pb-4 pt-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
            <Wrench className="h-7 w-7" />
          </div>
          <CardTitle className="mt-4 text-xl">Økonomi under udvikling</CardTitle>
          <CardDescription className="max-w-md mx-auto mt-2 text-sm text-muted-foreground">
            Vi arbejder på at færdiggøre det nye økonomioverblik. Her vil du fremover kunne følge dine udbetalinger, godkende fordelingsnøgler for medklippede produktioner og se dine Copydan-rettighedsmidler.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8 pt-2">
          <div className="grid gap-4 sm:grid-cols-3 max-w-2xl mx-auto mt-4 text-center">
            <div className="rounded-lg border bg-card p-4 text-left shadow-sm">
              <Wallet className="h-5 w-5 text-amber-600 mb-2" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Udbetalinger</h4>
              <p className="text-xs text-muted-foreground mt-1">Automatisk opgørelse over dine årlige royalty- og Copydan-midler.</p>
            </div>
            <div className="rounded-lg border bg-card p-4 text-left shadow-sm">
              <Clock className="h-5 w-5 text-amber-600 mb-2" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fordelingsnøgler</h4>
              <p className="text-xs text-muted-foreground mt-1">Gennemskuelig godkendelse af klippeandele for serier og film med medklippere.</p>
            </div>
            <div className="rounded-lg border bg-card p-4 text-left shadow-sm">
              <Wrench className="h-5 w-5 text-amber-600 mb-2" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</h4>
              <p className="text-xs text-muted-foreground mt-1">Live integration med DFKS udbetalingssystemet forberedes.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
