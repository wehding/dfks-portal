"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getContractValidation, saveContractValidation } from "@/app/actions/member-contracts";

// Fuld redigering af den AI-udtrukne kontraktdata. Skriver til samme
// contract_validations-tabel som valideringskøen, så de holdes i sync.

type FieldType = "text" | "number" | "date" | "bool" | "textarea";
type Field = { key: string; label: string; type: FieldType };

const GROUPS: { title: string; fields: Field[] }[] = [
    { title: "Identifikation", fields: [
        { key: "workTitle", label: "Værkstitel", type: "text" },
        { key: "rightsHolderName", label: "Rettighedshaver", type: "text" },
        { key: "producerName", label: "Producent", type: "text" },
        { key: "gender", label: "Køn", type: "text" },
        { key: "productionType", label: "Produktionstype", type: "text" },
        { key: "contractType", label: "Kontrakttype", type: "text" },
        { key: "creditedRoles", label: "Krediterede roller (komma-sep.)", type: "text" },
    ]},
    { title: "Overenskomst", fields: [
        { key: "overenskomst", label: "Overenskomst", type: "text" },
        { key: "collectiveAgreementName", label: "Overenskomst-navn", type: "text" },
        { key: "collectiveAgreement", label: "Overenskomst inkorporeret", type: "bool" },
        { key: "collectiveAgreementByReference", label: "Inkorporeret ved reference", type: "bool" },
        { key: "isFreelanceContract", label: "Freelance-kontrakt", type: "bool" },
    ]},
    { title: "Løn & periode", fields: [
        { key: "salary", label: "Løn", type: "number" },
        { key: "salaryUnit", label: "Løn-enhed", type: "text" },
        { key: "workingWeeks", label: "Arbejdsuger", type: "number" },
        { key: "startDate", label: "Startdato", type: "date" },
        { key: "endDate", label: "Slutdato", type: "date" },
    ]},
    { title: "Pension & tillæg", fields: [
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
        { key: "distribution", label: "Distribution (komma-sep.)", type: "text" },
    ]},
    { title: "Noter", fields: [
        { key: "specialNotes", label: "Særlige noter", type: "textarea" },
    ]},
];

const ARRAY_KEYS = new Set(["creditedRoles", "distribution"]);
const NUMBER_KEYS = new Set(["salary", "workingWeeks", "pensionPercent", "pensionSupplement", "personalSupplement", "royaltyPercent", "holidayPayRate", "betaRate"]);

type FormValues = Record<string, string | boolean>;

function toFormValues(ed: Record<string, unknown> | null): FormValues {
    const v: FormValues = {};
    for (const g of GROUPS) for (const f of g.fields) {
        const raw = ed?.[f.key];
        if (f.type === "bool") v[f.key] = !!raw;
        else if (ARRAY_KEYS.has(f.key)) v[f.key] = Array.isArray(raw) ? raw.join(", ") : (raw != null ? String(raw) : "");
        else v[f.key] = raw == null ? "" : String(raw);
    }
    return v;
}

function toExtractedData(v: FormValues): Record<string, unknown> {
    const ed: Record<string, unknown> = {};
    for (const g of GROUPS) for (const f of g.fields) {
        const val = v[f.key];
        if (f.type === "bool") ed[f.key] = !!val;
        else if (ARRAY_KEYS.has(f.key)) ed[f.key] = val ? String(val).split(",").map(s => s.trim()).filter(Boolean) : undefined;
        else if (NUMBER_KEYS.has(f.key)) ed[f.key] = val ? Number(val) : undefined;
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
                    <div className="grid grid-cols-2 gap-3">
                        {g.fields.map(f => (
                            <div key={f.key} className={f.type === "textarea" ? "col-span-2 space-y-1" : "space-y-1"}>
                                {f.type === "bool" ? (
                                    <label className="flex items-center gap-2 pt-4 text-xs">
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
