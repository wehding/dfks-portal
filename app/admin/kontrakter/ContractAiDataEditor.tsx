"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getContractValidation, saveContractValidation } from "@/app/actions/member-contracts";

// Fuld redigering af den AI-udtrukne kontraktdata. Skriver til den fælles
// contract_validations-tabel, så adminvisning og kontraktdata holdes i sync.

type FieldType = "text" | "number" | "date" | "bool" | "textarea";
type Field = { key: string; label: string; type: FieldType };

const RIGHT_OVERVIEW_FIELDS: Field[] = [
    { key: "rightsOverview.overenskomst", label: "Overenskomst", type: "bool" },
    { key: "rightsOverview.kreditering", label: "Kreditering", type: "bool" },
    { key: "rightsOverview.copydanforbehold", label: "Copydanforbehold", type: "bool" },
    { key: "rightsOverview.streamingforbehold", label: "Streamingforbehold", type: "bool" },
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

const GROUPS: { title: string; fields: Field[] }[] = [
    { title: "Produktion og parter", fields: [
        { key: "workTitle", label: "Værkstitel", type: "text" },
        { key: "director", label: "Instruktør", type: "text" },
        { key: "duration", label: "Varighed (min.)", type: "number" },
        { key: "premiereYear", label: "Premiereår", type: "number" },
        { key: "producerName", label: "Producent", type: "text" },
        { key: "employerName", label: "Produktionsselskab", type: "text" },
        { key: "parentCompanyName", label: "Moderselskab", type: "text" },
        { key: "rightsHolderName", label: "Rettighedshaver", type: "text" },
        { key: "creditedFunction", label: "Krediteret funktion", type: "text" },
        { key: "creditedRoles", label: "Krediterede roller", type: "text" },
        { key: "productionType", label: "Produktionstype", type: "text" },
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
        { key: "svod", label: "SVOD", type: "bool" },
        { key: "copydan", label: "Copydan", type: "bool" },
        { key: "aiDataMiningClause", label: "AI-data mining-forbehold", type: "bool" },
        { key: "futureRightsReservation", label: "Fremtidige rettigheder-forbehold", type: "bool" },
        ...RIGHT_OVERVIEW_FIELDS,
        { key: "distribution", label: "Distribution (komma-sep.)", type: "text" },
    ]},
];

const ARRAY_KEYS = new Set(["creditedRoles", "distribution"]);
const NUMBER_KEYS = new Set(["duration", "premiereYear", "salary", "workingDays", "workingWeeks", "loentillaeg", "pensionPercent", "pensionSupplement", "personalSupplement", "royaltyPercent", "holidayPayRate", "betaRate"]);

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

export function ContractAiDataEditor({ contractId }: { contractId: string }) {
    const [values, setValues] = useState<FormValues | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [found, setFound] = useState(false);

    useEffect(() => {
        let active = true;
        getContractValidation(contractId).then(res => {
            if (!active) return;
            const ed = res.success ? (res.extractedData ?? null) : null;
            setFound(Boolean(ed));
            setValues(toFormValues(ed));
            setLoading(false);
        });
        return () => { active = false; };
    }, [contractId]);

    const set = (k: string, val: string | boolean) => setValues(prev => ({ ...(prev ?? {}), [k]: val }));

    const save = async () => {
        if (!values) return;
        setSaving(true);
        const res = await saveContractValidation({ contractId, extractedData: toExtractedData(values) });
        setSaving(false);
        if (res.success) { toast.success("AI-data gemt"); setFound(true); }
        else toast.error(res.error ?? "Kunne ikke gemme AI-data");
    };

    if (loading || !values) {
        return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter AI-data…</div>;
    }

    return (
        <div className="space-y-4">
            {!found && <p className="text-xs text-muted-foreground">Ingen AI-data endnu — udfyld felterne og gem for at oprette valideringsdata.</p>}
            {GROUPS.map(g => (
                <div key={g.title}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
                    <div className={g.title === "Rettigheder" ? "flex flex-wrap gap-x-4 gap-y-2" : "grid grid-cols-2 gap-3"}>
                        {g.fields.map(f => (
                            <div key={f.key} className={f.type === "textarea" ? "col-span-2 space-y-1" : g.title === "Rettigheder" && f.type === "bool" ? "min-w-fit" : "space-y-1"}>
                                {f.type === "bool" ? (
                                    <label className="flex items-center gap-2 text-xs">
                                        <input type="checkbox" checked={!!values[f.key]} onChange={e => set(f.key, e.target.checked)} className="h-4 w-4" />
                                        {f.label}
                                    </label>
                                ) : (
                                    <>
                                        <Label className="text-xs">{f.label}</Label>
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
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
            <Button type="button" variant="outline" onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Gem AI-data
            </Button>
        </div>
    );
}
