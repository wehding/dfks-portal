import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PublicIndbetalingerPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b bg-card py-6">
        <div className="mx-auto flex max-w-2xl justify-center px-4">
          <Image src="/logo.png" alt="Dansk Filmklipperselskab" width={220} height={90} priority />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <CardTitle>Digital indbetaling er ikke åbnet endnu</CardTitle>
            <CardDescription>
              Formularen er under klargøring og kan endnu ikke modtage eller gemme indberetninger. Kontakt DFKS for den aktuelle fremgangsmåde.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Tilbage til login</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
