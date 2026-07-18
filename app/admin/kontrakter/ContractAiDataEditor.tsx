"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getContractValidation, saveContractValidation, updateAdminContractEpisodeAssignments } from "@/app/actions/member-contracts";
import { SourceBtn } from "@/components/source-btn";

// Fuld redigering af den AI-udtrukne kontraktdata. Skriver til den fælles
// contract_validations-tabel, så adminvisning og kontraktdata holdes i sync.

type FieldType = "text" | "number" | "date" | "bool" | "textarea";
type Field = { key: string; label: string; type: FieldType };

const RIGHT_OVERVIEW_FIELDS: Field[] = [
    { key: "rightsOverview.overenskomst", label: "Overenskomst", type: "bool" },
    { key: "rightsOverview.kreditering", label: "Kreditering", type: "bool" },
    { key: "rightsOverview.copydanforbehold", label: "Copydan-forbehold", type: "bool" },
    { key: "rightsOverview.streamingforbehold", label: "Streaming-forbehold", type: "bool" },
];

const SALARY_SOURCE_LABELS: Record<string, string> = {
    weekly: "Ugeløn fundet direkte",
    daily_converted: "Dagsats omregnet til ugeløn",
    hourly_converted: "Timesats omregnet til ugeløn",
    lump_calculated: "Samlet honorar fordelt over periode",
    invoice_line: "Fakturalinje",
    unknown: "Ukendt kilde",
};

const SALARY_SOURCE_VALUES = Object.fromEntries(
    Object.entries(SALARY_SOURCE_LABELS).map(([value, label]) => [label, value])
);

const FIELD_TO_SOURCE_KEY: Record<string, string> = {
    workTitle: "workTitle",
    salary: "salary",
    pensionPercent: "pension",
    personalSupplement: "supplements",
    otherSupplements: "otherSupplements",
    contractDate: "dates",
    startDate: "dates",
    endDate: "dates",
    workingWeeks: "workingWeeks",
    collectiveAgreement: "collectiveAgreement",
    copydan: "copydan",
    svod: "svod",
    royalty: "royalty",
};

const GROUPS: { title: string; fields: Field[] }[] = [
    { title: "Produktion og parter", fields: [
        { key: "workTitle", label: "Værkstitel", type: "text" },
        { key: "director", label: "Instruktør", type: "text" },
        { key: "duration", label: "Varighed (min.)", type: "number" },
        { key: "premiereYear", label: "Premiereår", type: "number" },
        { key: "genre", label: "Genre", type: "text" },
        { key: "employerName", label: "Producent / produktionsselskab", type: "text" },
        { key: "productionCompanies", label: "Produktionsselskaber", type: "text" },
        { key: "productionCountries", label: "Produktionslande", type: "text" },
        { key: "parentCompanyName", label: "Moderselskab", type: "text" },
        { key: "rightsHolderName", label: "Rettighedshaver", type: "text" },
        { key: "creditedFunction", label: "Krediteret funktion", type: "text" },
        { key: "creditedRoles", label: "Krediterede roller", type: "text" },
        { key: "productionType", label: "Produktionstype", type: "text" },
        { key: "seasonNumber", label: "Sæson", type: "number" },
        { key: "episodeNumber", label: "Afsnit", type: "number" },
        { key: "episodeCount", label: "Antal afsnit", type: "number" },
        { key: "seasonCount", label: "Antal sæsoner", type: "number" },
        { key: "dfiId", label: "DFI-id", type: "text" },
        { key: "tmdbId", label: "TMDB-id", type: "text" },
        { key: "imdbId", label: "IMDb-id", type: "text" },
        { key: "description", label: "Beskrivelse", type: "textarea" },
    ]},
    { title: "Kontrakt", fields: [
        { key: "contractType", label: "Kontrakttype", type: "text" },
        { key: "overenskomst", label: "Overenskomst", type: "text" },
        { key: "collectiveAgreementName", label: "Overenskomst-navn", type: "text" },
        { key: "collectiveAgreement", label: "Overenskomst inkorporeret", type: "bool" },
        { key: "collectiveAgreementByReference", label: "Inkorporeret ved reference", type: "bool" },
        { key: "isFreelanceContract", label: "Freelance-kontrakt", type: "bool" },
        { key: "contractDate", label: "Kontraktdato", type: "date" },
        { key: "startDate", label: "Startdato", type: "date" },
        { key: "endDate", label: "Slutdato", type: "date" },
    ]},
    { title: "Løn og periode", fields: [
        { key: "salary", label: "Ugeløn", type: "number" },
        { key: "salaryUnit", label: "Løn-enhed", type: "text" },
        { key: "salarySourceType", label: "Lønkilde", type: "text" },
        { key: "salaryConfidence", label: "Løn-confidence", type: "text" },
        { key: "salaryNote", label: "Løn-note", type: "textarea" },
        { key: "needsManualSalaryReview", label: "Kræver manuel løngennemgang", type: "bool" },
        { key: "workingDays", label: "Arbejdsdage", type: "number" },
        { key: "workingWeeks", label: "Arbejdsuger", type: "number" },
        { key: "loentillaeg", label: "Løntillæg", type: "number" },
        { key: "pensionPercent", label: "Pension %", type: "number" },
        { key: "pensionSupplement", label: "Pensionstillæg", type: "number" },
        { key: "personalSupplement", label: "Personligt tillæg", type: "number" },
        { key: "otherSupplements", label: "Øvrige tillæg", type: "text" },
        { key: "holidayPayRate", label: "Feriepenge %", type: "number" },
        { key: "betaRate", label: "Beta-sats", type: "number" },
    ]},
    { title: "Rettigheder", fields: [
        { key: "royalty", label: "Royalty", type: "bool" },
        { key: "royaltyPercent", label: "Royalty %", type: "number" },
        { key: "aiDataMiningClause", label: "AI-data mining-forbehold", type: "bool" },
        { key: "futureRightsReservation", label: "Fremtidige rettigheder-forbehold", type: "bool" },
        ...RIGHT_OVERVIEW_FIELDS,
        { key: "distribution", label: "Distribution (komma-sep.)", type: "text" },
    ]},
];

const ARRAY_KEYS = new Set(["creditedRoles", "distribution", "productionCompanies", "productionCountries"]);
const NUMBER_KEYS = new Set(["duration", "premiereYear", "seasonNumber", "episodeNumber", "episodeCount", "seasonCount", "salary", "workingDays", "workingWeeks", "loentillaeg", "pensionPercent", "pensionSupplement", "personalSupplement", "royaltyPercent", "holidayPayRate", "betaRate"]);

type LinkedEpisode = {
    id: string;
    title: string;
    seasonNumber: number;
    episodeNumber: number;
    role: string | null;
};

type EpisodeOption = Omit<LinkedEpisode, "role">;

type FormValues = Record<string, string | boolean>;

function toFormValues(ed: Record<string, unknown> | null): FormValues {
    const v: FormValues = {};
    for (const g of GROUPS) for (const f of g.fields) {
        const raw = f.key.startsWith("rightsOverview.")
            ? (ed?.rightsOverview as Record<string, unknown> | undefined)?.[f.key.split(".")[1]]
            : ed?.[f.key];
        if (f.key.startsWith("rightsOverview.")) {
            const value = String(raw ?? "").toLowerCase();
            v[f.key] = raw === true || value === "ja" || value.includes("implicit");
        }
        else if (f.type === "bool") v[f.key] = !!raw;
        // AI returnerer ISO 8601 med evt. tidskomponent; <input type="date">
        // kræver ren YYYY-MM-DD, ellers render feltet tomt og gemmer undefined.
        else if (f.type === "date") v[f.key] = raw == null ? "" : String(raw).slice(0, 10);
        else if (ARRAY_KEYS.has(f.key)) v[f.key] = Array.isArray(raw) ? raw.join(", ") : (raw != null ? String(raw) : "");
        else if (f.key === "salarySourceType") v[f.key] = raw == null ? "" : SALARY_SOURCE_LABELS[String(raw)] ?? String(raw);
        else if (raw && typeof raw === "object") v[f.key] = JSON.stringify(raw, null, 2);
        else v[f.key] = raw == null ? "" : String(raw);
    }
    return v;
}

function toExtractedData(v: FormValues): Record<string, unknown> {
    const ed: Record<string, unknown> = {};
    for (const g of GROUPS) for (const f of g.fields) {
        const val = v[f.key];
        if (f.key.startsWith("rightsOverview.")) {
            const key = f.key.split(".")[1];
            ed.rightsOverview = {
                ...((ed.rightsOverview as Record<string, unknown> | undefined) ?? {}),
                [key]: val ? "ja" : "nej",
            };
        }
        else if (f.type === "bool") ed[f.key] = !!val;
        else if (ARRAY_KEYS.has(f.key)) ed[f.key] = val ? String(val).split(",").map(s => s.trim()).filter(Boolean) : undefined;
        else if (NUMBER_KEYS.has(f.key)) ed[f.key] = val ? Number(val) : undefined;
        else if (f.key === "salarySourceType") ed[f.key] = val ? (SALARY_SOURCE_VALUES[String(val)] ?? String(val)) : undefined;
        else ed[f.key] = val ? String(val) : undefined;
    }
    return ed;
}

export function ContractAiDataEditor({
    contractId,
    activeHighlight,
    onHighlightClick,
}: {
    contractId: string;
    activeHighlight?: string | null;
    onHighlightClick: (quote: string) => void;
}) {
    const [values, setValues] = useState<FormValues | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [found, setFound] = useState(false);
    const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
    const [sources, setSources] = useState<Record<string, string | null> | null>(null);
    const [linkedEpisodes, setLinkedEpisodes] = useState<LinkedEpisode[]>([]);
    const [episodeOptions, setEpisodeOptions] = useState<EpisodeOption[]>([]);
    const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<string[]>([]);
    const [isSeriesWork, setIsSeriesWork] = useState(false);
    const [savingEpisodes, setSavingEpisodes] = useState(false);
    const loadedRef = useRef(false);

    useEffect(() => {
        let active = true;
        getContractValidation(contractId).then(res => {
            if (!active) return;
            const ed = res.success ? (res.extractedData ?? null) : null;
            setFound(Boolean(ed && Object.keys(ed).length > 0));
            setValues(toFormValues(ed));
            setLockedFields(new Set((ed?._lockedFields ?? []) as string[]));
            setSources((ed?._sources ?? null) as Record<string, string | null>);
            setLinkedEpisodes(res.success ? (res.linkedEpisodes ?? []) : []);
            setEpisodeOptions(res.success ? (res.episodeOptions ?? []) : []);
            setSelectedEpisodeIds(res.success ? (res.linkedEpisodes ?? []).map(episode => episode.id) : []);
            setIsSeriesWork(res.success ? Boolean(res.isSeriesWork) : false);
            setLoading(false);
            loadedRef.current = true;
        });
        return () => { active = false; loadedRef.current = false; };
    }, [contractId]);

    const set = (k: string, val: string | boolean) => {
        setValues(prev => ({ ...(prev ?? {}), [k]: val }));
        setLockedFields(prev => {
            const next = new Set(prev);
            next.add(k);
            return next;
        });
    };

    const toggleLock = (key: string) => {
        setLockedFields(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const save = async (nextValues = values, nextLockedFields = lockedFields, showToast = true) => {
        if (!nextValues) return;
        setSaving(true);
        const ed = toExtractedData(nextValues);
        ed._lockedFields = Array.from(nextLockedFields);
        if (sources) {
            ed._sources = sources;
        }
        const res = await saveContractValidation({ contractId, extractedData: ed });
        setSaving(false);
        if (res.success) { if (showToast) toast.success("Data gemt"); setFound(true); }
        else toast.error(res.error ?? "Kunne ikke gemme data");
    };

    useEffect(() => {
        if (!loadedRef.current || !values) return;
        const timer = window.setTimeout(() => {
            void save(values, lockedFields, false);
        }, 700);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [values, lockedFields]);

    if (loading || !values) {
        return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter data…</div>;
    }

    return (
        <div className="space-y-4">
            {!found && <p className="text-xs text-muted-foreground">Ingen data endnu — udfyld felterne for at oprette valideringsdata.</p>}
            {isSeriesWork && (
                <div className="rounded-md border bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Afsnit knyttet til medlemmet</p>
                    {episodeOptions.length > 0 ? (
                        <div className="space-y-3">
                            <div className="grid gap-2 sm:grid-cols-2">
                                {episodeOptions.map(episode => (
                                    <label key={episode.id} className="flex cursor-pointer items-start gap-2 rounded-md border bg-background px-3 py-2 text-xs">
                                        <input
                                            type="checkbox"
                                            className="mt-0.5 h-4 w-4"
                                            checked={selectedEpisodeIds.includes(episode.id)}
                                            onChange={event => setSelectedEpisodeIds(current => event.target.checked
                                                ? [...current, episode.id]
                                                : current.filter(id => id !== episode.id))}
                                        />
                                        <span>
                                            <span className="font-semibold">S{String(episode.seasonNumber).padStart(2, "0")}E{String(episode.episodeNumber).padStart(2, "0")}</span>
                                            {episode.title ? <span className="ml-1 text-muted-foreground">· {episode.title}</span> : null}
                                        </span>
                                    </label>
                                ))}
                            </div>
                            <button
                                type="button"
                                disabled={savingEpisodes}
                                onClick={async () => {
                                    setSavingEpisodes(true);
                                    const res = await updateAdminContractEpisodeAssignments({ contractId, selectedWorkIds: selectedEpisodeIds });
                                    setSavingEpisodes(false);
                                    if (!res.success) {
                                        toast.error(res.error ?? "Kunne ikke gemme afsnit");
                                        return;
                                    }
                                    const roleById = new Map(linkedEpisodes.map(episode => [episode.id, episode.role]));
                                    setLinkedEpisodes(episodeOptions.filter(episode => selectedEpisodeIds.includes(episode.id)).map(episode => ({
                                        ...episode,
                                        role: roleById.get(episode.id) ?? "Klipper",
                                    })));
                                    toast.success("Afsnitstilknytninger gemt");
                                }}
                                className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
                            >
                                {savingEpisodes ? "Gemmer…" : "Gem afsnit"}
                            </button>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">Serien har endnu ingen oprettede afsnit.</p>
                    )}
                </div>
            )}
            {GROUPS.map(g => (
                <div key={g.title}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
                    <div className={g.title === "Rettigheder" ? "flex flex-wrap gap-x-4 gap-y-2" : "grid gap-3 sm:grid-cols-2"}>
                        {g.fields.map(f => {
                            const sourceKey = FIELD_TO_SOURCE_KEY[f.key];
                            const quote = sources?.[sourceKey];
                            const isLocked = lockedFields.has(f.key);

                            return (
                                <div key={f.key} className={f.type === "textarea" ? "col-span-2 space-y-1" : g.title === "Rettigheder" && f.type === "bool" ? "min-w-fit" : "space-y-1"}>
	                                    {f.type === "bool" ? (
	                                        <div className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0 min-h-[32px] gap-4">
	                                            <button
	                                                type="button"
	                                                onClick={() => set(f.key, !values[f.key])}
	                                                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
	                                                    values[f.key]
	                                                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
	                                                        : "border-input bg-background text-muted-foreground hover:bg-muted"
	                                                }`}
	                                            >
	                                                {f.label}: {values[f.key] ? "Ja" : "Nej"}
	                                            </button>
                                            <div className="flex items-center gap-1">
                                                {quote && (
                                                    <SourceBtn
                                                        quote={quote}
                                                        active={activeHighlight === quote}
                                                        onClick={() => onHighlightClick(quote)}
                                                    />
                                                )}
                                                <button
                                                    type="button"
                                                    title={isLocked ? "Feltet er låst for AI-overskrivning" : "Lås felt for AI-overskrivning"}
                                                    onClick={() => toggleLock(f.key)}
                                                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                                                >
                                                    {isLocked ? <Lock className="h-3.5 w-3.5 text-amber-600" /> : <Unlock className="h-3.5 w-3.5 opacity-30 hover:opacity-75" />}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs">{f.label}</Label>
                                                <div className="flex items-center gap-1">
                                                    {quote && (
                                                        <SourceBtn
                                                            quote={quote}
                                                            active={activeHighlight === quote}
                                                            onClick={() => onHighlightClick(quote)}
                                                        />
                                                    )}
                                                    <button
                                                        type="button"
                                                        title={isLocked ? "Feltet er låst for AI-overskrivning" : "Lås felt for AI-overskrivning"}
                                                        onClick={() => toggleLock(f.key)}
                                                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        {isLocked ? <Lock className="h-3.5 w-3.5 text-amber-600" /> : <Unlock className="h-3.5 w-3.5 opacity-30 hover:opacity-75" />}
                                                    </button>
                                                </div>
                                            </div>
                                            {f.type === "textarea" ? (
                                                <Textarea value={String(values[f.key] ?? "")} onChange={e => set(f.key, e.target.value)} />
                                            ) : (
                                                <Input
                                                    type={f.type === "date" ? "date" : "text"}
                                                    inputMode={f.type === "number" ? "decimal" : undefined}
                                                    className="h-8 text-xs"
                                                    value={String(values[f.key] ?? "")}
                                                    onChange={e => set(f.key, e.target.value)}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
	            {saving && <p className="text-xs text-muted-foreground">Gemmer ændringer...</p>}
	        </div>
    );
}
