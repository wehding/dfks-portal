"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, BrainCircuit, Coins, Database, Loader2, Save, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n"

type UseCase = "contract_extraction" | "contract_advice" | "statistics_query"
type Model = { provider: "anthropic" | "google"; model: string; label: string; description: string; useCases: UseCase[] }
type Setting = { use_case: UseCase; provider: string; model: string; prompt_caching_enabled: boolean; updated_at: string }
type Price = { provider: string; model: string; pricing_mode: "standard" | "batch"; input_usd_per_million: number; output_usd_per_million: number; cache_write_usd_per_million: number; cache_read_usd_per_million: number }
type UsageEvent = {
    id: string; run_id: string | null; org_id: string | null; use_case: UseCase; stage: string; provider: string; model: string
    input_tokens: number; output_tokens: number; thinking_tokens: number; cache_write_tokens: number; cache_read_tokens: number
    usage_estimated: boolean; cost_usd: number; cost_dkk: number | null; latency_ms: number | null; status: string; created_at: string
}
type Payload = {
    caller: { role: string; orgId: string; canEdit: boolean }
    models: Model[]; settings: Setting[]; prices: Price[]; events: UsageEvent[]
    exchangeRate: { rate_date: string; usd_dkk: number; source: string } | null
    organisations: Array<{ id: string; name: string }>
    statisticsContractScope: "validated_only" | "validated_and_drafts"
    statisticsHealth: {
        activeModel: string | null
        latestSuccessAt: string | null
        latestFailure: { at: string | null; category: string } | null
        latestCpiPeriod: string | null
    }
}

const COPY = {
    da: {
        title: "Forbrug og modeller", subtitle: "Faktiske tokens, priser og permanente modelvalg for kontrakt- og statistik-AI.",
        month: "Denne måned", runs: "AI-behandlinger", extraction: "Aflæsning", advice: "Rådgivning", statistics: "Statistik", tokens: "Tokens i alt",
        models: "Aktive modeller", model: "Model", save: "Gem modelvalg", caching: "Anthropic Prompt Caching (5 min.)",
        cachingHelp: "Kan reducere inputprisen ved gentagne kald med samme faste prompt. Første cache-write er dyrere.",
        readOnly: "Kun superadmin kan ændre modeller. Du ser forbruget for din organisation.", comparison: "Prisforskel på periodens tokenprofil",
        noUsage: "Der er endnu ingen registrerede AI-kald i den valgte periode. Nye kald måles automatisk.",
        recent: "Seneste AI-kald", date: "Tid", stage: "Del", usage: "Input / output", thinking: "Thinking", cost: "Pris", status: "Status",
        standard: "Standard", batch: "Batch-estimat", batchHelp: "Batch er kun en prisberegning og sender ikke kontrakter asynkront.",
        estimated: "~ betyder estimeret tokenforbrug for embeddings.",
        statisticsHealth: "Status for statistikassistenten", activeStatisticsModel: "Aktiv model", latestStatisticsSuccess: "Seneste succes", latestStatisticsError: "Seneste fejlkategori", latestCpi: "Seneste inflationstal", never: "Ingen endnu", unavailable: "Ikke tilgængelig",
    },
    en: {
        title: "Usage and models", subtitle: "Actual tokens, prices and permanent model choices for contract and statistics AI.",
        month: "This month", runs: "AI operations", extraction: "Extraction", advice: "Advice", statistics: "Statistics", tokens: "Total tokens",
        models: "Active models", model: "Model", save: "Save model choice", caching: "Anthropic Prompt Caching (5 min)",
        cachingHelp: "Can reduce input cost for repeated calls with the same stable prompt. The first cache write costs more.",
        readOnly: "Only superadmins can change models. You are viewing usage for your organisation.", comparison: "Price difference for the period's token profile",
        noUsage: "No AI calls have been recorded in the selected period yet. New calls are metered automatically.",
        recent: "Latest AI calls", date: "Time", stage: "Stage", usage: "Input / output", thinking: "Thinking", cost: "Cost", status: "Status",
        standard: "Standard", batch: "Batch estimate", batchHelp: "Batch is a price estimate only and does not submit contracts asynchronously.",
        estimated: "~ marks estimated embedding token usage.",
        statisticsHealth: "Statistics assistant status", activeStatisticsModel: "Active model", latestStatisticsSuccess: "Latest success", latestStatisticsError: "Latest error category", latestCpi: "Latest inflation data", never: "None yet", unavailable: "Unavailable",
    },
} as const

function sum(events: UsageEvent[], field: keyof UsageEvent) {
    return events.reduce((total, event) => total + Number(event[field] ?? 0), 0)
}

export function AiUsageModelsTab() {
    const { locale } = useI18n()
    const text = COPY[locale === "en" ? "en" : "da"]
    const [data, setData] = useState<Payload | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState<UseCase | null>(null)
    const [orgFilter, setOrgFilter] = useState("all")
    const [statisticsScope, setStatisticsScope] = useState<"validated_only" | "validated_and_drafts">("validated_only")
    const [drafts, setDrafts] = useState<Record<UseCase, { provider: string; model: string; promptCachingEnabled: boolean }> | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch("/api/admin/ai-control", { cache: "no-store" })
            const payload = await response.json()
            if (!response.ok) throw new Error(payload.error ?? "Kunne ikke hente AI-forbrug")
            setData(payload)
            setStatisticsScope(payload.statisticsContractScope ?? "validated_only")
            const settings = Object.fromEntries((payload.settings as Setting[]).map(setting => [setting.use_case, {
                provider: setting.provider, model: setting.model, promptCachingEnabled: setting.prompt_caching_enabled,
            }])) as Record<UseCase, { provider: string; model: string; promptCachingEnabled: boolean }>
            setDrafts(settings)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Kunne ikke hente AI-forbrug")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => { void load() }, [load])

    const filteredEvents = useMemo(() => (data?.events ?? []).filter(event => orgFilter === "all" || event.org_id === orgFilter), [data, orgFilter])

    const totals = useMemo(() => {
        const events = filteredEvents
        return {
            dkk: sum(events, "cost_dkk"), usd: sum(events, "cost_usd"),
            runs: new Set(events.map(event => event.run_id).filter(Boolean)).size,
            extraction: sum(events.filter(event => event.use_case === "contract_extraction"), "cost_dkk"),
            advice: sum(events.filter(event => event.use_case === "contract_advice"), "cost_dkk"),
            statistics: sum(events.filter(event => event.use_case === "statistics_query"), "cost_dkk"),
            tokens: sum(events, "input_tokens") + sum(events, "output_tokens"),
        }
    }, [filteredEvents])

    const formatDkk = (value: number) => new Intl.NumberFormat(locale === "en" ? "en-DK" : "da-DK", { style: "currency", currency: "DKK", minimumFractionDigits: value < 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value)
    const formatNumber = (value: number) => new Intl.NumberFormat(locale === "en" ? "en" : "da-DK").format(value)

    async function save(useCase: UseCase) {
        if (!drafts) return
        const selectedLabel = data?.models.find(model => model.model === drafts[useCase].model)?.label ?? drafts[useCase].model
        if (!window.confirm(locale === "en" ? `Use ${selectedLabel} for future requests?` : `Brug ${selectedLabel} til fremtidige kald?`)) return
        setSaving(useCase)
        try {
            const draft = drafts[useCase]
            const response = await fetch("/api/admin/ai-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useCase, ...draft }) })
            const payload = await response.json()
            if (!response.ok) throw new Error(payload.error ?? "Modelvalget kunne ikke gemmes")
            toast.success(locale === "en" ? "Model choice saved" : "Modelvalg gemt")
            await load()
        } catch (error) { toast.error(error instanceof Error ? error.message : "Modelvalget kunne ikke gemmes") }
        finally { setSaving(null) }
    }

    async function saveStatisticsScope(value: "validated_only" | "validated_and_drafts") {
        setStatisticsScope(value)
        try {
            const response = await fetch("/api/admin/ai-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ statisticsContractScope: value }),
            })
            const payload = await response.json()
            if (!response.ok) throw new Error(payload.error ?? "Statistikgrundlaget kunne ikke gemmes")
            toast.success(locale === "en" ? "Statistics source saved" : "Statistikgrundlag gemt")
        } catch (error) {
            setStatisticsScope(data?.statisticsContractScope ?? "validated_only")
            toast.error(error instanceof Error ? error.message : "Statistikgrundlaget kunne ikke gemmes")
        }
    }

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
    if (!data || !drafts) return <p className="py-8 text-sm text-muted-foreground">{text.noUsage}</p>

    const cards = [
        { label: text.month, value: formatDkk(totals.dkk), sub: `$${totals.usd.toFixed(2)}`, icon: Coins },
        { label: text.runs, value: formatNumber(totals.runs), sub: "", icon: Activity },
        { label: text.extraction, value: formatDkk(totals.extraction), sub: "", icon: Database },
        { label: text.advice, value: formatDkk(totals.advice), sub: "", icon: BrainCircuit },
        { label: text.statistics, value: formatDkk(totals.statistics), sub: "", icon: Activity },
        { label: text.tokens, value: formatNumber(totals.tokens), sub: "", icon: ShieldCheck },
    ]

    return <div className="min-w-0 space-y-4 sm:space-y-6">
        <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between"><div className="min-w-0"><h2 className="text-lg font-semibold">{text.title}</h2><p className="text-sm text-muted-foreground">{text.subtitle}</p></div>{data.caller.role === "superadmin" && data.organisations.length > 0 && <div className="w-full space-y-1 sm:w-64"><Label>{locale === "en" ? "Organisation" : "Organisation"}</Label><Select value={orgFilter} onValueChange={setOrgFilter}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{locale === "en" ? "All organisations" : "Alle organisationer"}</SelectItem>{data.organisations.map(org => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}</SelectContent></Select></div>}</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{cards.map(card => <Card key={card.label}>
            <CardHeader className="pb-2"><CardDescription className="flex items-center gap-2"><card.icon className="h-4 w-4" />{card.label}</CardDescription></CardHeader>
            <CardContent><p className="text-2xl font-semibold tabular-nums">{card.value}</p>{card.sub && <p className="text-xs text-muted-foreground">{card.sub}</p>}</CardContent>
        </Card>)}</div>

        <Card><CardHeader><CardTitle>{text.statisticsHealth}</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{text.activeStatisticsModel}</p><p className="mt-1 break-words text-sm font-medium">{data.models.find(model => `${model.provider}/${model.model}` === data.statisticsHealth?.activeModel)?.label ?? data.statisticsHealth?.activeModel ?? text.unavailable}</p></div>
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{text.latestStatisticsSuccess}</p><p className="mt-1 text-sm font-medium">{data.statisticsHealth?.latestSuccessAt ? new Date(data.statisticsHealth.latestSuccessAt).toLocaleString(locale === "en" ? "en-GB" : "da-DK") : text.never}</p></div>
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{text.latestStatisticsError}</p><p className="mt-1 break-words text-sm font-medium">{data.statisticsHealth?.latestFailure?.category ?? text.never}</p></div>
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{text.latestCpi}</p><p className="mt-1 text-sm font-medium">{data.statisticsHealth?.latestCpiPeriod ?? text.unavailable}</p></div>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>{locale === "en" ? "Statistics contract source" : "Kontraktgrundlag for statistik"}</CardTitle><CardDescription>{locale === "en" ? "Drafts can contain incomplete or unverified extraction data." : "Kladder kan indeholde ufuldstændige eller endnu ikke kontrollerede udtræksdata."}</CardDescription></CardHeader><CardContent className="max-w-md">
            <Select value={statisticsScope} onValueChange={value => void saveStatisticsScope(value as "validated_only" | "validated_and_drafts")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="validated_only">{locale === "en" ? "Validated contracts only" : "Kun validerede kontrakter"}</SelectItem>
                    <SelectItem value="validated_and_drafts">{locale === "en" ? "Validated contracts and drafts" : "Validerede kontrakter og kladder"}</SelectItem>
                </SelectContent>
            </Select>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>{text.models}</CardTitle>{!data.caller.canEdit && <CardDescription>{text.readOnly}</CardDescription>}</CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-3">{(["contract_extraction", "contract_advice", "statistics_query"] as UseCase[]).map(useCase => {
                const draft = drafts[useCase]
                const options = data.models.filter(model => model.useCases.includes(useCase))
                return <div key={useCase} className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4">
                    <div><h3 className="font-medium">{useCase === "contract_extraction" ? text.extraction : useCase === "contract_advice" ? text.advice : text.statistics}</h3><p className="text-xs text-muted-foreground">{options.find(model => model.model === draft.model)?.description}</p></div>
                    <div className="space-y-1.5"><Label>{text.model}</Label><Select disabled={!data.caller.canEdit} value={`${draft.provider}/${draft.model}`} onValueChange={value => {
                        const [provider, model] = value.split("/")
                        setDrafts(current => current ? { ...current, [useCase]: { provider, model, promptCachingEnabled: provider === "anthropic" ? current[useCase].promptCachingEnabled : false } } : current)
                    }}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.model} value={`${option.provider}/${option.model}`}>{option.label}</SelectItem>)}</SelectContent></Select></div>
                    {draft.provider === "anthropic" && <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Label htmlFor={`cache-${useCase}`}>{text.caching}</Label><p className="text-xs text-muted-foreground">{text.cachingHelp}</p></div><Switch className="shrink-0" id={`cache-${useCase}`} disabled={!data.caller.canEdit} checked={draft.promptCachingEnabled} onCheckedChange={checked => setDrafts(current => current ? { ...current, [useCase]: { ...current[useCase], promptCachingEnabled: checked } } : current)} /></div>}
                    {data.caller.canEdit && <Button onClick={() => save(useCase)} disabled={saving === useCase} className="w-full gap-2 sm:w-auto">{saving === useCase ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{text.save}</Button>}
                </div>
            })}</CardContent>
        </Card>

        <Card className="min-w-0"><CardHeader><CardTitle>{text.comparison}</CardTitle><CardDescription>{text.batchHelp}</CardDescription></CardHeader><CardContent>
            {filteredEvents.length === 0 ? <p className="text-sm text-muted-foreground">{text.noUsage}</p> : <><div className="space-y-2 sm:hidden">{data.models.map(model => {
                const relevant = filteredEvents.filter(event => model.useCases.includes(event.use_case))
                const standard = data.prices.find(price => price.provider === model.provider && price.model === model.model && price.pricing_mode === "standard")
                if (!standard) return null
                const usd = relevant.reduce((total, event) => total + (Number(event.input_tokens) * Number(standard.input_usd_per_million) + Number(event.output_tokens) * Number(standard.output_usd_per_million) + Number(event.cache_write_tokens) * Number(standard.cache_write_usd_per_million) + Number(event.cache_read_tokens) * Number(standard.cache_read_usd_per_million)) / 1_000_000, 0)
                const rate = Number(data.exchangeRate?.usd_dkk ?? 0)
                return <div key={model.model} className="rounded-lg border p-3"><p className="break-words font-medium">{model.label}</p><div className="mt-2 grid grid-cols-2 gap-2 text-sm"><div><p className="text-xs text-muted-foreground">{text.standard}</p><p className="font-medium">{rate ? formatDkk(usd * rate) : `$${usd.toFixed(3)}`}</p></div><div><p className="text-xs text-muted-foreground">{text.batch}</p><p className="font-medium">{rate ? formatDkk(usd * rate * .5) : `$${(usd * .5).toFixed(3)}`}</p></div></div></div>
            })}</div><div className="hidden overflow-x-auto sm:block"><Table><TableHeader><TableRow><TableHead>{text.model}</TableHead><TableHead>{text.extraction}</TableHead><TableHead>{text.advice}</TableHead><TableHead>{text.statistics}</TableHead><TableHead>{text.standard}</TableHead><TableHead>{text.batch}</TableHead></TableRow></TableHeader><TableBody>{data.models.map(model => {
                const relevant = filteredEvents.filter(event => model.useCases.includes(event.use_case))
                const standard = data.prices.find(price => price.provider === model.provider && price.model === model.model && price.pricing_mode === "standard")
                if (!standard) return null
                const usd = relevant.reduce((total, event) => total + (
                    Number(event.input_tokens) * Number(standard.input_usd_per_million) +
                    Number(event.output_tokens) * Number(standard.output_usd_per_million) +
                    Number(event.cache_write_tokens) * Number(standard.cache_write_usd_per_million) +
                    Number(event.cache_read_tokens) * Number(standard.cache_read_usd_per_million)
                ) / 1_000_000, 0)
                const rate = Number(data.exchangeRate?.usd_dkk ?? 0)
                return <TableRow key={model.model}><TableCell className="font-medium">{model.label}</TableCell><TableCell>{model.useCases.includes("contract_extraction") ? "✓" : "—"}</TableCell><TableCell>{model.useCases.includes("contract_advice") ? "✓" : "—"}</TableCell><TableCell>{model.useCases.includes("statistics_query") ? "✓" : "—"}</TableCell><TableCell>{rate ? formatDkk(usd * rate) : `$${usd.toFixed(3)}`}</TableCell><TableCell>{rate ? formatDkk(usd * rate * .5) : `$${(usd * .5).toFixed(3)}`}</TableCell></TableRow>
            })}</TableBody></Table></div></>}
        </CardContent></Card>

        <Card className="min-w-0"><CardHeader><CardTitle>{text.recent}</CardTitle><CardDescription>{data.exchangeRate && <>USD/DKK {Number(data.exchangeRate.usd_dkk).toFixed(4)} · {data.exchangeRate.source} · {data.exchangeRate.rate_date}<br /></>}{text.estimated}</CardDescription></CardHeader><CardContent><div className="space-y-2 sm:hidden">{filteredEvents.slice(0, 50).map(event => <div key={event.id} className="rounded-lg border p-3 text-sm"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-medium">{event.stage}</p><p className="break-all text-xs text-muted-foreground">{event.model}</p></div><span className="shrink-0 text-xs">{event.status}</span></div><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2"><div><dt className="text-xs text-muted-foreground">{text.usage}</dt><dd className="tabular-nums">{event.usage_estimated ? "~" : ""}{formatNumber(Number(event.input_tokens))} / {formatNumber(Number(event.output_tokens))}</dd></div><div><dt className="text-xs text-muted-foreground">{text.cost}</dt><dd>{event.cost_dkk == null ? `$${Number(event.cost_usd).toFixed(4)}` : formatDkk(Number(event.cost_dkk))}</dd></div></dl><p className="mt-2 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString(locale === "en" ? "en-GB" : "da-DK")}</p></div>)}</div><div className="hidden overflow-x-auto sm:block"><Table><TableHeader><TableRow><TableHead>{text.date}</TableHead><TableHead>{text.stage}</TableHead><TableHead>{text.model}</TableHead><TableHead>{text.usage}</TableHead><TableHead>{text.thinking}</TableHead><TableHead>{text.cost}</TableHead><TableHead>{text.status}</TableHead></TableRow></TableHeader><TableBody>{filteredEvents.slice(0, 50).map(event => <TableRow key={event.id}><TableCell className="whitespace-nowrap text-xs">{new Date(event.created_at).toLocaleString(locale === "en" ? "en-GB" : "da-DK")}</TableCell><TableCell>{event.stage}</TableCell><TableCell className="text-xs">{event.model}</TableCell><TableCell className="tabular-nums">{event.usage_estimated ? "~" : ""}{formatNumber(Number(event.input_tokens))} / {formatNumber(Number(event.output_tokens))}</TableCell><TableCell className="tabular-nums">{formatNumber(Number(event.thinking_tokens))}</TableCell><TableCell>{event.cost_dkk == null ? `$${Number(event.cost_usd).toFixed(4)}` : formatDkk(Number(event.cost_dkk))}</TableCell><TableCell>{event.status}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    </div>
}
