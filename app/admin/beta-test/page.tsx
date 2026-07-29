"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Preview = {
  organisation: { name: string };
  cleanup: { works: Array<{ id: string; title: string; year: number | null }>; workCount: number; assignmentCount: number; contractCount: number; destructiveActionPerformed: false };
  invitations: Array<{ row: number; name: string; email: string; role: string; errors: string[]; action: "reuse" | "invite" }>;
};

export default function BetaTestPage() {
  const [orgId, setOrgId] = useState("");
  const [rows, setRows] = useState("");
  const [testWorkIds, setTestWorkIds] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggleBeta = async (enabled: boolean) => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/admin/beta/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, enabled }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Kunne ikke ændre betateststatus"); }
    finally { setLoading(false); }
  };
  const preview = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const invitations = rows.split(/\r?\n/).filter(Boolean).map(line => { const [name, email, role] = line.split(";"); return { name, email, role }; });
      const response = await fetch("/api/admin/beta/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, invitations }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error); setResult(json);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Forhåndsvisningen fejlede"); }
    finally { setLoading(false); }
  };
  const markWorks = async (isTestData: boolean) => {
    setLoading(true); setError(null);
    try {
      const workIds = testWorkIds.split(/[\s,;]+/).filter(Boolean);
      const response = await fetch("/api/admin/beta/works", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, workIds, isTestData }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      setError(`${json.updated} værker blev ${isTestData ? "markeret" : "afmarkeret"} som testdata.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Værkerne kunne ikke markeres"); }
    finally { setLoading(false); }
  };
  return <div className="space-y-6">
    <PageHeader title="Betatest" subtitle="Forhåndsvis oprydning og invitationer uden at ændre data" />
    <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Sikker forhåndsvisning</AlertTitle><AlertDescription>Denne side sletter aldrig værker og sender aldrig invitationer. Kun værker, der eksplicit er markeret som testdata, medtages.</AlertDescription></Alert>
    <div className="space-y-3 rounded-lg border p-4">
      <Input value={orgId} onChange={event => setOrgId(event.target.value)} placeholder="Testorganisationens id" />
      <div className="flex gap-2"><Button variant="outline" onClick={() => toggleBeta(true)} disabled={loading}>Markér som betatest</Button><Button variant="outline" onClick={() => toggleBeta(false)} disabled={loading}>Fjern betatestmarkering</Button></div>
      <Textarea value={testWorkIds} onChange={event => setTestWorkIds(event.target.value)} placeholder="Værk-id’er, der eksplicit skal markeres som testdata" rows={3} />
      <div className="flex gap-2"><Button variant="outline" onClick={() => markWorks(true)} disabled={loading || !testWorkIds.trim()}>Markér testværker</Button><Button variant="outline" onClick={() => markWorks(false)} disabled={loading || !testWorkIds.trim()}>Fjern testmarkering</Button></div>
      <Textarea value={rows} onChange={event => setRows(event.target.value)} placeholder={"Navn;email@eksempel.dk;member\nNæste navn;email2@eksempel.dk;member"} rows={8} />
      <Button onClick={preview} disabled={loading || !orgId}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lav forhåndsvisning</Button>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {result && <div className="space-y-4">
      <div className="rounded-lg border p-4"><h2 className="font-semibold">Oprydning i {result.organisation.name}</h2><p className="text-sm text-muted-foreground">{result.cleanup.workCount} testværker, {result.cleanup.assignmentCount} tilknytninger og {result.cleanup.contractCount} kontrakter. Intet er slettet.</p><ul className="mt-2 text-sm">{result.cleanup.works.map(work => <li key={work.id}>{work.title} {work.year ? `(${work.year})` : ""}</li>)}</ul></div>
      <div className="rounded-lg border p-4"><h2 className="font-semibold">Invitationer</h2><ul className="mt-2 space-y-1 text-sm">{result.invitations.map(row => <li key={row.row}>{row.name} · {row.email} · {row.errors.length ? row.errors.join(", ") : row.action === "reuse" ? "Genbrug eksisterende profil" : "Klar til invitation"}</li>)}</ul></div>
    </div>}
  </div>;
}
