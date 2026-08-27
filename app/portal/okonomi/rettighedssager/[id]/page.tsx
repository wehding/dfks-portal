"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, FileUp, Loader2, MessageSquare } from "lucide-react"
import { toast } from "sonner"

import { getMemberEntitlementCase, sendEntitlementCaseMessage, uploadEntitlementEvidence, type MemberEntitlementCaseDetail } from "@/app/actions/rights-entitlement-cases"
import { PortalPageHeader } from "@/components/portal/portal-page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export default function MemberEntitlementCasePage() {
  const caseId = useParams<{ id: string }>().id
  const [item, setItem] = useState<MemberEntitlementCaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  const load = useCallback(async () => {
    const result = await getMemberEntitlementCase(caseId)
    if (!result.success) toast.error(result.error ?? "Sagen kunne ikke hentes")
    setItem(result.entitlementCase)
    setLoading(false)
  }, [caseId])
  useEffect(() => { void Promise.resolve().then(load) }, [load])

  if (loading) return <div className="p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
  if (!item) return <div className="space-y-4"><PortalPageHeader title="Rettighedssag" subtitle="Sagen findes ikke" /><Link href="/portal/okonomi">Tilbage</Link></div>
  const position = item.position
  const evidence = item.evidence
  const messages = item.messages
  const closed = ["confirmed", "rejected", "administratively_closed"].includes(item.status)

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/portal/okonomi" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />Økonomi</Link>
      <PortalPageHeader title={item.workTitle} subtitle={`${item.rightType.toUpperCase()} · mulig rettighedsposition`} />
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4" /><div><p className="font-medium">Dokumentation for rettighedsforbehold mangler</p><p className="mt-1 text-sm">Din mulige rettighedsposition er tilbageholdt på værket, mens sagen afklares. Beløbet tæller ikke med i dit udbetalingsklare beløb.</p></div></div>
      </div>
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
        <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="outline">{item.status}</Badge></div>
        <div><p className="text-xs text-muted-foreground">Mulig andel</p><p className="font-medium">{(position.withheldAmount / 100).toLocaleString("da-DK", { style: "currency", currency: position.currency })}</p></div>
        <div><p className="text-xs text-muted-foreground">Kravsfrist</p><p className="font-medium">{position.claimDeadline ?? "—"}</p></div>
      </div>
      {!closed && (
        <form className="space-y-4 rounded-lg border p-4" action={async formData => {
          setSaving(true); formData.set("caseId", caseId)
          const result = await uploadEntitlementEvidence(formData); setSaving(false)
          if (result.success) { toast.success("Dokumentationen er sendt til administrator"); await load() }
          else toast.error(result.error ?? "Upload fejlede")
        }}>
          <div><h2 className="font-medium">Indsend dokumentation</h2><p className="text-sm text-muted-foreground">Kontrakt, allonge, producenterklæring, arvedokumentation eller anden relevant dokumentation.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="attachmentType">Dokumenttype</Label><select id="attachmentType" name="attachmentType" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="contract">Kontrakt</option><option value="addendum">Allonge/tillæg</option><option value="producer_declaration">Producenterklæring</option><option value="inheritance">Arvedokumentation</option><option value="other">Andet</option></select></div><div className="space-y-1"><Label htmlFor="file">Fil</Label><Input id="file" name="file" type="file" required accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png" /></div></div>
          <div className="space-y-1"><Label htmlFor="message">Besked til administrator (valgfri)</Label><Textarea id="message" name="message" /></div>
          <Button disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}Send dokumentation</Button>
        </form>
      )}
      <div className="space-y-3 rounded-lg border p-4"><h2 className="font-medium">Indsendte dokumenter</h2>{evidence.length ? evidence.map(entry => <div key={entry.id} className="flex justify-between border-t pt-2 text-sm"><span>{entry.originalFilename}</span><Badge variant="secondary">{entry.reviewStatus}</Badge></div>) : <p className="text-sm text-muted-foreground">Ingen dokumenter indsendt endnu.</p>}</div>
      <div className="space-y-3 rounded-lg border p-4"><h2 className="flex items-center gap-2 font-medium"><MessageSquare className="h-4 w-4" />Beskeder om sagen</h2>{messages.map(entry => <div key={entry.id} className={`rounded-md p-3 text-sm ${entry.authorRole === "member" ? "ml-8 bg-primary/10" : "mr-8 bg-muted"}`}><p>{entry.body}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("da-DK")}</p></div>)}<div className="flex gap-2"><Textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Skriv til administrator om denne rettighed…" /><Button variant="outline" disabled={!message.trim()} onClick={async () => { const result = await sendEntitlementCaseMessage(caseId, message); if (result.success) { setMessage(""); await load() } else toast.error(result.error ?? "Beskeden kunne ikke sendes") }}>Send</Button></div></div>
    </div>
  )
}
