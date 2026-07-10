"use client"

import { useState, useMemo, useEffect } from "react"
import { CalendarDays, Loader2 } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,
    Bar,
    Legend,
    PieChart,
    Pie,
    Cell,
    ReferenceLine,
} from "recharts"

function formatKr(n: number) {
    return n.toLocaleString("da-DK") + " kr."
}

const tooltipStyle: React.CSSProperties = {
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    borderRadius: "12px",
    fontSize: "13px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
    color: "#1a1a2e",
}

const tooltipWrapperStyle: React.CSSProperties = { zIndex: 50 }

const PIE_COLORS = ["hsl(340, 65%, 55%)", "hsl(210, 65%, 55%)", "hsl(160, 50%, 50%)"]

// ── DB-kontrakt type ──────────────────────────────────────────
type DbContractRow = {
    id: string
    type: string
    overenskomst: string | null
    contract_date: string | null
    start_date: string | null
    premiereYear: number
    extractedData: Record<string, any> | null
    rhName: string | null
}

/**
 * Beregner antal arbejdsuger der falder inden for et givet kalenderår.
 * Bruges til at fordele kontrakter der spænder over to år korrekt.
 * Forudsætning: arbejde er jævnt fordelt over kontraktperioden.
 */
function getWeeksInYear(
    startDateStr: string | null,
    endDateStr: string | null,
    totalWeeks: number,
    year: number
): number {
    if (!startDateStr || totalWeeks <= 0) return totalWeeks // ingen datoer → tæl alt

    const start = new Date(startDateStr)
    const end = endDateStr
        ? new Date(endDateStr)
        : new Date(start.getTime() + totalWeeks * 7 * 24 * 60 * 60 * 1000)

    const yearStart = new Date(year, 0, 1)
    const yearEnd   = new Date(year + 1, 0, 1)

    const overlapStart = new Date(Math.max(start.getTime(), yearStart.getTime()))
    const overlapEnd   = new Date(Math.min(end.getTime(),   yearEnd.getTime()))

    if (overlapEnd <= overlapStart) return 0

    const overlapDays = (overlapEnd.getTime() - overlapStart.getTime()) / 86400000
    const totalDays   = (end.getTime()        - start.getTime())        / 86400000

    if (totalDays <= 0) return totalWeeks
    return Math.round((totalWeeks * (overlapDays / totalDays)) * 10) / 10
}

function toMonthly(salary: number, unit: string): number {
    if (unit === "monthly") return salary
    if (unit === "weekly")  return Math.round(salary * 52 / 12)
    if (unit === "daily")   return Math.round(salary * 5 * 52 / 12)
    return salary
}

function prodTypeLabel(type: string): string {
    const map: Record<string, string> = {
        feature: "Spillefilm", tvSeries: "TV-serie", documentary: "Dokumentar",
        docSeries: "Dok.-serie", short: "Kortfilm", tvEntertainment: "TV-underholdning",
        reality: "Reality", other: "Andet",
    }
    return map[type] ?? type
}

export default function AdminStatistikPage() {
    const { t } = useI18n()
    const [selectedYear, setSelectedYear] = useState<string>("all")
    const [selectedGender, setSelectedGender] = useState<string>("all")
    const [dbContracts, setDbContracts] = useState<DbContractRow[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            const orgId = user?.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"

            const { data: contractsData } = await supabase
                .from("contracts")
                .select("id, type, overenskomst, status, contract_date, start_date, rights_holder_id, rettighedshavere(full_name)")
                .eq("org_id", orgId)
                .in("status", ["valideret", "kladde"])
                .order("contract_date", { ascending: true })

            const ids = (contractsData ?? []).map((c: any) => c.id)
            const { data: validationsData } = ids.length > 0
                ? await supabase.from("contract_validations").select("contract_id, extracted_data").in("contract_id", ids)
                : { data: [] }

            const validationMap = new Map<string, any>()
            ;(validationsData ?? []).forEach((v: any) => validationMap.set(v.contract_id, v.extracted_data))

            const rows: DbContractRow[] = (contractsData ?? []).map((c: any) => {
                const ed = validationMap.get(c.id) ?? null
                // Brug startdato til årsplacering — ikke kontraktdato (som kan være signeret et andet år)
                const dateStr = ed?.startDate ?? c.start_date ?? ed?.contractDate ?? c.contract_date ?? null
                const year = dateStr ? new Date(dateStr).getFullYear() : new Date().getFullYear()
                return { id: c.id, type: c.type, overenskomst: c.overenskomst, contract_date: c.contract_date, start_date: c.start_date, premiereYear: year, extractedData: ed, rhName: (c as any).rettighedshavere?.full_name ?? null }
            })
            rows.forEach(r => console.log("[statistik]", {
                title: r.id.slice(0,8),
                rhName: r.rhName,
                year: r.premiereYear,
                salary: r.extractedData?.salary,
                salaryUnit: r.extractedData?.salaryUnit,
                weeks: r.extractedData?.workingWeeks,
                startDate: r.extractedData?.startDate,
                cStartDate: r.start_date,
            }))
            setDbContracts(rows)
            setLoading(false)
        }
        load()
    }, [])

    // ── Filtered data based on selected year ───────────────────
    const yearNum = selectedYear === "all" ? null : Number(selectedYear)

    const allYears = useMemo(() =>
        [...new Set(dbContracts.map(c => c.premiereYear))].sort((a, b) => b - a),
        [dbContracts])

    const filteredContracts = useMemo(() => {
        let cs = yearNum ? dbContracts.filter(c => c.premiereYear === yearNum) : dbContracts
        if (selectedGender !== "all") {
            cs = cs.filter(c => {
                const g = c.extractedData?.gender
                if (selectedGender === "other") return g && g !== "male" && g !== "female"
                return g === selectedGender
            })
        }
        return cs
    }, [yearNum, selectedGender, dbContracts])

    // Beregn lønstatistik per år
    const filteredSalary = useMemo(() => {
        const years = yearNum ? [yearNum] : [...new Set(dbContracts.map(c => c.premiereYear))].sort()
        return years.map(y => {
            const cs = dbContracts.filter(c => c.premiereYear === y && c.extractedData?.salary)
            const monthly = cs.filter(c => c.type !== "leverandør").map(c => toMonthly(c.extractedData!.salary, c.extractedData!.salaryUnit ?? "monthly"))
            const daily = cs.map(c => c.extractedData!.salary && c.extractedData!.salaryUnit === "daily" ? c.extractedData!.salary : toMonthly(c.extractedData!.salary, c.extractedData!.salaryUnit ?? "monthly") / (52/12*5))
            return {
                year: y,
                monthlyRate: monthly.length ? Math.round(monthly.reduce((a,b)=>a+b,0)/monthly.length) : 0,
                dailyRate: daily.length ? Math.round(daily.reduce((a,b)=>a+b,0)/daily.length) : 0,
            }
        }).filter(d => d.monthlyRate > 0 || d.dailyRate > 0)
    }, [yearNum, dbContracts])

    // Pension per år
    const filteredPension = useMemo(() => {
        const years = yearNum ? [yearNum] : [...new Set(dbContracts.map(c => c.premiereYear))].sort()
        return years.map(y => {
            const cs = dbContracts.filter(c => c.premiereYear === y && c.extractedData?.pensionPercent)
            const avg = cs.length ? cs.reduce((a, c) => a + (c.extractedData!.pensionPercent ?? 0), 0) / cs.length : 0
            const avgSupp = cs.length ? cs.reduce((a, c) => a + (c.extractedData!.personalSupplement ?? 0), 0) / cs.length : 0
            return { year: y, avgPensionPercent: Math.round(avg * 10) / 10, avgPersonalSupplement: Math.round(avgSupp) }
        }).filter(d => d.avgPensionPercent > 0)
    }, [yearNum, dbContracts])

    // Arbejdsuger per år — fordelt præcist på kalenderår via getWeeksInYear
    const filteredWeeks = useMemo(() => {
        const allYearsSet = [...new Set(dbContracts.map(c => c.premiereYear))].sort()
        const years = yearNum ? [yearNum] : allYearsSet
        return years.map(y => {
            const weeksInYear = dbContracts
                .filter(c => c.extractedData?.workingWeeks)
                .map(c => {
                    const ed = c.extractedData!
                    const startStr = ed.startDate ?? c.start_date ?? null
                    const endStr   = ed.endDate ?? null
                    return getWeeksInYear(startStr, endStr, ed.workingWeeks as number, y)
                })
                .filter(w => w > 0)

            if (weeksInYear.length === 0) return null
            const sorted = [...weeksInYear].sort((a, b) => a - b)
            const avg    = sorted.reduce((a, b) => a + b, 0) / sorted.length
            const median = sorted[Math.floor(sorted.length / 2)]
            return { year: y, avgWeeks: Math.round(avg * 10) / 10, medianWeeks: Math.round(median * 10) / 10 }
        }).filter(Boolean) as { year: number; avgWeeks: number; medianWeeks: number }[]
    }, [yearNum, dbContracts])

    // Producentbidrag per år
    const filteredContributions = useMemo(() => {
        const years = yearNum ? [yearNum] : [...new Set(dbContracts.map(c => c.premiereYear))].sort()
        return years.map(y => {
            const cs = dbContracts.filter(c => c.premiereYear === y)
            const avgH = cs.filter(c => c.extractedData?.holidayPayRate).reduce((a,c) => a + (c.extractedData!.holidayPayRate ?? 0), 0) / (cs.filter(c => c.extractedData?.holidayPayRate).length || 1)
            const avgB = cs.filter(c => c.extractedData?.betaRate).reduce((a,c) => a + (c.extractedData!.betaRate ?? 0), 0) / (cs.filter(c => c.extractedData?.betaRate).length || 1)
            return { year: y, avgHolidayPayRate: Math.round(avgH*10)/10, avgBetaRate: Math.round(avgB*100)/100, totalHolidayPayAmount: 0, totalBetaAmount: 0, contractCount: cs.length }
        }).filter(d => d.contractCount > 0)
    }, [yearNum, dbContracts])

    // Årsindkomst fordelt på køn — gennemsnit per unik PERSON (ikke per kontrakt)
    const incomeByGender = useMemo(() => {
        // Byg person-map: { [name]: { gender, totalEarnings, totalWeeks } }
        const personMap: Record<string, { gender: string; totalEarnings: number; totalWeeks: number }> = {}

        for (const c of filteredContracts) {
            const ed = c.extractedData
            if (!ed?.salary) continue
            const gender = ed.gender === "male" ? "male" : ed.gender === "female" ? "female" : "other"
            const name = c.rhName ?? ed.rightsHolderName ?? `_unknown_${c.id}`
            const baseWeekly = ed.salaryUnit === "weekly" ? ed.salary
                : ed.salaryUnit === "daily" ? ed.salary * 5
                : ed.salaryUnit === "monthly" ? Math.round(ed.salary * 12 / 52)
                : ed.salary
            const weeklyRate = baseWeekly + (ed.personalSupplement ?? 0)
            const startStr = ed.startDate ?? c.start_date ?? null
            const endStr   = ed.endDate ?? null
            const weeks = yearNum
                ? getWeeksInYear(startStr, endStr, ed.workingWeeks ?? 0, yearNum)
                : (ed.workingWeeks ?? 0)
            if (weeks <= 0) continue
            if (!personMap[name]) personMap[name] = { gender, totalEarnings: 0, totalWeeks: 0 }
            personMap[name].totalEarnings += weeklyRate * weeks
            personMap[name].totalWeeks += weeks
        }

        // Aggregér per køn — gennemsnit per person
        const genders = { male: "male", female: "female", other: "other" } as const
        return Object.fromEntries(Object.entries(genders).map(([key, gVal]) => {
            const persons = Object.values(personMap).filter(p => p.gender === gVal)
            const personCount = persons.length
            const totalEarnings = persons.reduce((s, p) => s + p.totalEarnings, 0)
            const totalWeeks    = persons.reduce((s, p) => s + p.totalWeeks, 0)
            const avgAnnual  = personCount > 0 ? Math.round(totalEarnings / personCount) : 0
            const avgWeekly  = totalWeeks  > 0 ? Math.round(totalEarnings / totalWeeks)  : 0
            const avgWeeksPerPerson = personCount > 0 ? Math.round(totalWeeks / personCount * 10) / 10 : 0
            return [key, {
                label: key === "male" ? "Mand" : key === "female" ? "Kvinde" : "Andet",
                count: personCount,
                totalEarnings,
                totalWeeks,
                avgAnnual,
                avgWeekly,
                avgWeeksPerPerson,
            }]
        })) as Record<"male"|"female"|"other", { label: string; count: number; totalEarnings: number; totalWeeks: number; avgAnnual: number; avgWeekly: number; avgWeeksPerPerson: number }>
    }, [filteredContracts, yearNum])

    // Klipperindkomst per person
    const editorIncome = useMemo(() => {
        const map: Record<string, { name: string; contracts: { year: number; weeklyRate: number; weeks: number; total: number }[] }> = {}

        for (const c of filteredContracts) {
            // Brug rhName fra DB, ellers rightsHolderName fra extracted_data, ellers "Ukendt"
            const name = c.rhName ?? c.extractedData?.rightsHolderName ?? "Ukendt"
            const ed = c.extractedData
            if (!ed?.salary) continue

            const baseWeekly = ed.salaryUnit === "weekly" ? ed.salary
                : ed.salaryUnit === "daily" ? ed.salary * 5
                : ed.salaryUnit === "monthly" ? Math.round(ed.salary * 12 / 52)
                : ed.salary
            const personalSupplement = ed.personalSupplement ?? 0
            const weeklyRate = baseWeekly + personalSupplement
            const totalWeeks = ed.workingWeeks ?? 0

            // Fordel uger præcist på det valgte år (eller alle år)
            const startStr = ed.startDate ?? c.start_date ?? null
            const endStr   = ed.endDate ?? null
            const weeks = yearNum
                ? getWeeksInYear(startStr, endStr, totalWeeks, yearNum)
                : totalWeeks  // alle år: summer hele kontrakten

            const total = Math.round(weeklyRate * weeks)

            if (!map[name]) map[name] = { name, contracts: [] }
            map[name].contracts.push({ year: c.premiereYear, weeklyRate, baseWeekly, weeks, total, isFreelance: c.type === "leverandør" || !!c.extractedData?.isFreelanceContract } as any)
        }

        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        return Object.values(map)
            .map(e => {
                const totalWeeks = e.contracts.reduce((s, c) => s + c.weeks, 0)
                const totalEarnings = e.contracts.reduce((s, c) => s + c.total, 0)
                const totalBase = e.contracts.reduce((s, c) => s + ((c as any).baseWeekly ?? (c as any).weeklyRate) * c.weeks, 0)
                return {
                    name: e.name,
                    contractCount: e.contracts.length,
                    totalEarnings,
                    totalWeeks: Math.round(totalWeeks * 10) / 10,
                    avgWeekly: totalWeeks > 0 ? Math.round(totalEarnings / totalWeeks) : 0,
                    avgBaseWeekly: totalWeeks > 0 ? Math.round(totalBase / totalWeeks) : 0,  // grundløn uden tillæg
                    isFreelance: e.contracts.some(c => (c as any).isFreelance),
                    yearlyBreakdown: e.contracts,
                }
            })
            .filter(e => e.totalEarnings > 0)
            .sort((a, b) => b.totalEarnings - a.totalEarnings)
            .map((e, i) => ({
                ...e,
                displayName: `Klipper ${letters[i] ?? i + 1}`,  // anonymiseret
            }))
            .filter(e => e.totalEarnings > 0)
            .sort((a, b) => b.avgWeekly - a.avgWeekly)
    }, [filteredContracts, yearNum])

    // Producentbidrag per produktion
    const contributionsByProduction = useMemo(() => {
        return filteredContracts
            .filter(c => c.extractedData?.salary)
            .map(c => {
                const ed = c.extractedData!
                const baseWeekly = ed.salaryUnit === "weekly" ? ed.salary
                    : ed.salaryUnit === "daily" ? ed.salary * 5
                    : ed.salaryUnit === "monthly" ? Math.round(ed.salary * 12 / 52)
                    : ed.salary
                const weeks = ed.workingWeeks ?? 0
                const totalSalary = Math.round(baseWeekly * weeks)
                const holidayRate = ed.holidayPayRate ?? 1        // 1% standard
                const betaRate    = ed.betaRate    ?? 0.5         // 0.5% standard
                const isFreelance = c.type === "leverandør" || !!ed.isFreelanceContract
                return {
                    title: ed.workTitle ?? c.extractedData?.producerName ?? "Ukendt produktion",
                    employer: null as string | null,
                    weeks,
                    weeklyRate: baseWeekly,
                    totalSalary,
                    holidayPay: isFreelance ? 0 : Math.round(totalSalary * (holidayRate / 100)),
                    beta:       isFreelance ? 0 : Math.round(totalSalary * (betaRate    / 100)),
                    holidayRate,
                    betaRate,
                    isFreelance,
                    contractId: c.id,
                }
            })
            .sort((a, b) => (b.holidayPay + b.beta) - (a.holidayPay + a.beta))
    }, [filteredContracts])

    // Antal kontrakter per år — baseret på startdato
    const contractsPerYear = useMemo(() => {
        const getStartYear = (c: DbContractRow): number | null => {
            const startStr = c.extractedData?.startDate ?? c.start_date ?? null
            if (!startStr) return null
            return new Date(startStr).getFullYear()
        }

        const yearsSet = new Set<number>()
        dbContracts.forEach(c => { const y = getStartYear(c); if (y) yearsSet.add(y) })
        const allYears = [...yearsSet].sort()
        const years = yearNum ? [yearNum] : allYears

        return years.map(y => {
            let cs = dbContracts.filter(c => getStartYear(c) === y)
            // Anvend kønsfilter
            if (selectedGender !== "all") {
                cs = cs.filter(c => {
                    const g = c.extractedData?.gender
                    if (selectedGender === "other") return g && g !== "male" && g !== "female"
                    return g === selectedGender
                })
            }
            const uniquePersons = new Set(cs.map(c => c.rhName ?? c.extractedData?.rightsHolderName).filter(Boolean)).size || 1
            return {
                year: y,
                total: cs.length,
                aLoen: cs.filter(c => c.type === "a-løn").length,
                leverandoer: cs.filter(c => c.type !== "a-løn").length,
                uniquePersons,
                avgPerPerson: Math.round((cs.length / uniquePersons) * 10) / 10,
            }
        }).filter(d => d.total > 0)
    }, [yearNum, selectedGender, dbContracts])

    // Rettighedsstatistik per produktionstype
    const rightsStats = useMemo(() => {
        const types = [...new Set(filteredContracts.map(c => c.extractedData?.productionType).filter(Boolean))]
        return types.map(type => {
            const cs = filteredContracts.filter(c => c.extractedData?.productionType === type)
            const total = cs.length || 1
            return {
                category: prodTypeLabel(type),
                svodPercent: Math.round(cs.filter(c => c.extractedData?.svod).length / total * 100),
                copydanPercent: Math.round(cs.filter(c => c.extractedData?.copydan).length / total * 100),
                royaltyPercent: Math.round(cs.filter(c => c.extractedData?.royalty).length / total * 100),
            }
        })
    }, [filteredContracts])

    // Gender distribution from filtered contracts
    const genderData = useMemo(() => {
        const contractsWithGender = filteredContracts.filter(
            (c) => c.extractedData?.gender
        )
        if (contractsWithGender.length === 0) return []

        const groups: Record<string, { count: number; totalSalary: number }> = {}
        for (const c of contractsWithGender) {
            const g = c.extractedData!.gender!
            const label = g === "female" ? "Kvinde" : g === "male" ? "Mand" : "Andet"
            if (!groups[label]) groups[label] = { count: 0, totalSalary: 0 }
            groups[label].count++
            groups[label].totalSalary += c.extractedData?.salary || 0
        }
        return Object.entries(groups).map(([gender, data]) => ({
            gender,
            count: data.count,
            avgSalary: Math.round(data.totalSalary / data.count),
        }))
    }, [filteredContracts])

    // AI clause stats from filtered contracts
    const aiStats = useMemo(() => {
        const withData = filteredContracts.filter((c) => c.extractedData)
        const withClause = withData.filter((c) => c.extractedData?.aiDataMiningClause)
        const pct = withData.length > 0 ? Math.round((withClause.length / withData.length) * 100) : 0

        // Group by year
        const byYear = withData.reduce<Record<number, { total: number; withClause: number }>>(
            (acc, c) => {
                const y = c.premiereYear
                if (!acc[y]) acc[y] = { total: 0, withClause: 0 }
                acc[y].total++
                if (c.extractedData?.aiDataMiningClause) acc[y].withClause++
                return acc
            },
            {}
        )

        const chartData = Object.entries(byYear)
            .map(([year, data]) => ({
                year,
                withClause: data.withClause,
                withoutClause: data.total - data.withClause,
                pct: Math.round((data.withClause / data.total) * 100),
            }))
            .sort((a, b) => Number(a.year) - Number(b.year))

        return { withData, withClause, pct, chartData }
    }, [filteredContracts])

    // Summary for selected year
    const yearSummary = useMemo(() => {
        const salary = filteredSalary[filteredSalary.length - 1]
        const pension = filteredPension[filteredPension.length - 1]
        const weeks = filteredWeeks[filteredWeeks.length - 1]
        return { salary, pension, weeks }
    }, [filteredSalary, filteredPension, filteredWeeks])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (dbContracts.length === 0) {
        return (
            <div className="space-y-6">
                <PageHeader title={t("admin.stats.title")} subtitle={t("admin.stats.subtitle")} />
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-2">
                    <CalendarDays className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm font-medium">Ingen kontrakter med data endnu</p>
                    <p className="text-xs text-muted-foreground max-w-sm">
                        Upload og importer kontrakter — statistik beregnes automatisk fra de udtrukne data.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.stats.title")}
                subtitle={`${dbContracts.length} kontrakt${dbContracts.length !== 1 ? "er" : ""} · data fra AI-udtræk`}
            />

            {/* Filters */}
            <div className="grid gap-3 sm:flex sm:flex-wrap">
                {/* YEAR SELECTOR — primary filter */}
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="w-full border-primary/30 bg-primary/5 font-medium sm:w-[160px]">
                        <CalendarDays className="mr-2 h-3.5 w-3.5 text-primary" />
                        <SelectValue placeholder={t("admin.stats.filterYear")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle år</SelectItem>
                        {allYears.map((y) => (
                            <SelectItem key={y} value={y.toString()}>
                                {y}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select defaultValue="all">
                    <SelectTrigger className="w-full sm:w-[160px]">
                        <SelectValue placeholder={t("admin.stats.filterCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle kategorier</SelectItem>
                        <SelectItem value="feature">{t("cat.feature")}</SelectItem>
                        <SelectItem value="tvSeries">{t("cat.tvSeries")}</SelectItem>
                        <SelectItem value="documentary">{t("cat.documentary")}</SelectItem>
                    </SelectContent>
                </Select>
                <Select defaultValue="all">
                    <SelectTrigger className="w-full sm:w-[160px]">
                        <SelectValue placeholder={t("admin.stats.filterRole")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle roller</SelectItem>
                        <SelectItem value="klipper">Klipper</SelectItem>
                        <SelectItem value="instruktor">Instruktør</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={selectedGender} onValueChange={setSelectedGender}>
                    <SelectTrigger className="w-full sm:w-[140px]">
                        <SelectValue placeholder={t("admin.stats.filterGender")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle køn</SelectItem>
                        <SelectItem value="male">{t("admin.stats.male")}</SelectItem>
                        <SelectItem value="female">{t("admin.stats.female")}</SelectItem>
                        <SelectItem value="other">Andet</SelectItem>
                    </SelectContent>
                </Select>
                {selectedGender !== "all" && (
                    <Badge variant="secondary" className="self-center gap-1">
                        Køn: {selectedGender === "male" ? "Mand" : selectedGender === "female" ? "Kvinde" : "Andet"}
                        <button onClick={() => setSelectedGender("all")} className="ml-1 hover:text-foreground">×</button>
                    </Badge>
                )}

                {yearNum && (
                    <Badge variant="secondary" className="self-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        Vis data for {yearNum}
                    </Badge>
                )}
            </div>

            {/* Summary cards for selected year */}
            {yearNum && yearSummary.salary && (
                <div className="hidden gap-4 sm:grid sm:grid-cols-4">
                    <Card>
                        <CardContent className="pt-6 text-center">
                            <p className="text-2xl font-bold tabular-nums">
                                {formatKr(yearSummary.salary.monthlyRate)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {t("admin.stats.monthlyRate")} ({yearNum})
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6 text-center">
                            <p className="text-2xl font-bold tabular-nums">
                                {formatKr(yearSummary.salary.dailyRate)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {t("admin.stats.dailyRate")} ({yearNum})
                            </p>
                        </CardContent>
                    </Card>
                    {yearSummary.pension && (
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-2xl font-bold tabular-nums">
                                    {yearSummary.pension.avgPensionPercent}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.stats.avgPension")} ({yearNum})
                                </p>
                            </CardContent>
                        </Card>
                    )}
                    {yearSummary.weeks && (
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-2xl font-bold tabular-nums">
                                    {yearSummary.weeks.avgWeeks} uger
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.stats.avgWeeks")} ({yearNum})
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            <Tabs defaultValue="salary">
                <TabsList className="flex-wrap">
                    <TabsTrigger value="salary">{t("admin.stats.salaryDev")}</TabsTrigger>
                    <TabsTrigger value="rights">{t("admin.stats.rightsClauses")}</TabsTrigger>
                    <TabsTrigger value="pension">{t("admin.stats.pension")}</TabsTrigger>
                    <TabsTrigger value="gender">{t("admin.stats.genderDist")}</TabsTrigger>
                    <TabsTrigger value="weeks">{t("admin.stats.workingWeeks")}</TabsTrigger>
                    <TabsTrigger value="contributions">{t("admin.stats.producerContributions")}</TabsTrigger>
                    <TabsTrigger value="aiClause">{t("admin.validation.aiClause")}</TabsTrigger>
                    <TabsTrigger value="contractCount">Antal kontrakter</TabsTrigger>
                    <TabsTrigger value="editors">Årsindkomst</TabsTrigger>
                </TabsList>

                {/* ── Salary Development ─────────────────────────── */}
                <TabsContent value="salary" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.dailyRate")} & {t("admin.stats.monthlyRate")}
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum} markeret
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] min-w-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={filteredSalary}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis className="text-xs" tickFormatter={(v) => `${v / 1000}k`} />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            wrapperStyle={tooltipWrapperStyle}
                                            formatter={(value) => formatKr(value as number)}
                                        />
                                        <Legend />
                                        {yearNum && (
                                            <ReferenceLine
                                                x={yearNum}
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                                label={{
                                                    value: yearNum.toString(),
                                                    position: "top",
                                                    fill: "hsl(var(--primary))",
                                                    fontSize: 12,
                                                }}
                                            />
                                        )}
                                        <Line
                                            type="monotone"
                                            dataKey="monthlyRate"
                                            name={t("admin.stats.monthlyRate")}
                                            stroke="hsl(210, 65%, 55%)"
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="dailyRate"
                                            name={t("admin.stats.dailyRate")}
                                            stroke="hsl(160, 50%, 50%)"
                                            strokeWidth={2}
                                            strokeDasharray="5 5"
                                            dot={{ r: 3 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("admin.stats.filterYear")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.dailyRate")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.monthlyRate")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSalary.map((d) => (
                                    <TableRow
                                        key={d.year}
                                        className={yearNum === d.year ? "bg-primary/5 font-semibold" : ""}
                                    >
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {formatKr(d.dailyRate)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {formatKr(d.monthlyRate)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── Rights Clauses ──────────────────────────────── */}
                <TabsContent value="rights" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.rightsClauses")} — % med klausul pr. kategori
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum}
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] min-w-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={rightsStats}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="category" className="text-xs" />
                                        <YAxis className="text-xs" tickFormatter={(v) => `${v}%`} />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            wrapperStyle={tooltipWrapperStyle}
                                            formatter={(value) => `${value}%`}
                                        />
                                        <Legend />
                                        <Bar
                                            dataKey="svodPercent"
                                            name="SVOD"
                                            fill="hsl(210, 65%, 55%)"
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="copydanPercent"
                                            name="Copydan"
                                            fill="hsl(160, 50%, 50%)"
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="royaltyPercent"
                                            name="Royalty"
                                            fill="hsl(340, 65%, 55%)"
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Pension & Supplement Stats ──────────────────── */}
                <TabsContent value="pension" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.avgPension")} & {t("admin.stats.avgPersonalSupp")} pr. år
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum} markeret
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] min-w-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={filteredPension}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis
                                            yAxisId="left"
                                            className="text-xs"
                                            tickFormatter={(v) => `${v}%`}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            className="text-xs"
                                            tickFormatter={(v) => `${v / 1000}k`}
                                        />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            wrapperStyle={tooltipWrapperStyle}
                                            formatter={(value, name) =>
                                                name === t("admin.stats.avgPension")
                                                    ? `${value}%`
                                                    : formatKr(value as number)
                                            }
                                        />
                                        <Legend />
                                        {yearNum && (
                                            <ReferenceLine
                                                x={yearNum}
                                                yAxisId="left"
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                            />
                                        )}
                                        <Line
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="avgPensionPercent"
                                            name={t("admin.stats.avgPension")}
                                            stroke="hsl(210, 65%, 55%)"
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                        />
                                        <Line
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="avgPersonalSupplement"
                                            name={t("admin.stats.avgPersonalSupp")}
                                            stroke="hsl(340, 65%, 55%)"
                                            strokeWidth={2}
                                            strokeDasharray="5 5"
                                            dot={{ r: 3 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>År</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgPension")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgPersonalSupp")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredPension.map((d) => (
                                    <TableRow
                                        key={d.year}
                                        className={yearNum === d.year ? "bg-primary/5 font-semibold" : ""}
                                    >
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.avgPensionPercent}%</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatKr(d.avgPersonalSupplement)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── Gender Distribution ─────────────────────────── */}
                <TabsContent value="gender" className="mt-4 space-y-4">
                    {yearNum && (
                        <Badge variant="outline" className="gap-1">
                            <CalendarDays className="h-3 w-3" />
                            Data filtreret for {yearNum}
                        </Badge>
                    )}
                    <div className="grid gap-4 lg:grid-cols-2">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {t("admin.stats.genderDist")}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[300px] min-w-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={genderData}
                                                dataKey="count"
                                                nameKey="gender"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={100}
                                                label={({ name, value }) =>
                                                    `${name}: ${value}`
                                                }
                                            >
                                                {genderData.map((_, i) => (
                                                    <Cell
                                                        key={`cell-${i}`}
                                                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={tooltipStyle}
                                                wrapperStyle={tooltipWrapperStyle} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {t("admin.stats.avgSalary")} pr. køn
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[300px] min-w-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={genderData}>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                            <XAxis dataKey="gender" className="text-xs" />
                                            <YAxis className="text-xs" tickFormatter={(v) => `${v / 1000}k`} />
                                            <Tooltip
                                                contentStyle={tooltipStyle}
                                                wrapperStyle={tooltipWrapperStyle}
                                                formatter={(value) => formatKr(value as number)}
                                            />
                                            <Bar
                                                dataKey="avgSalary"
                                                name={t("admin.stats.avgSalary")}
                                                radius={[4, 4, 0, 0]}
                                            >
                                                {genderData.map((_, i) => (
                                                    <Cell
                                                        key={`cell-${i}`}
                                                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Køn</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.count")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgSalary")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {genderData.map((d) => (
                                    <TableRow key={d.gender}>
                                        <TableCell className="font-medium">{d.gender}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.count}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatKr(d.avgSalary)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── Working Weeks ───────────────────────────────── */}
                <TabsContent value="weeks" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.avgWeeks")} & {t("admin.stats.medianWeeks")} pr. år
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum} markeret
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] min-w-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={filteredWeeks}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis className="text-xs" />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            wrapperStyle={tooltipWrapperStyle}
                                            formatter={(value) => `${value} uger`}
                                        />
                                        <Legend />
                                        {yearNum && (
                                            <ReferenceLine
                                                x={yearNum}
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                            />
                                        )}
                                        <Bar
                                            dataKey="avgWeeks"
                                            name={t("admin.stats.avgWeeks")}
                                            fill="hsl(210, 65%, 55%)"
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="medianWeeks"
                                            name={t("admin.stats.medianWeeks")}
                                            fill="hsl(30, 80%, 55%)"
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>År</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgWeeks")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.medianWeeks")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredWeeks.map((d) => (
                                    <TableRow
                                        key={d.year}
                                        className={yearNum === d.year ? "bg-primary/5 font-semibold" : ""}
                                    >
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.avgWeeks}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.medianWeeks}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── Producer Contributions (Helligdagsbetaling & BETA) ─── */}
                <TabsContent value="contributions" className="mt-4 space-y-4">
                    {yearNum && (
                        <Badge variant="outline" className="gap-1">
                            <CalendarDays className="h-3 w-3" />
                            Data filtreret for {yearNum}
                        </Badge>
                    )}

                    {/* Summary cards */}
                    <div className="hidden gap-4 sm:grid sm:grid-cols-3">
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-2xl font-bold tabular-nums">
                                    {filteredContributions[filteredContributions.length - 1]?.avgHolidayPayRate || 0}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.stats.avgHolidayPay")}
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-2xl font-bold tabular-nums">
                                    {filteredContributions[filteredContributions.length - 1]?.avgBetaRate || 0}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.stats.avgBeta")}
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-2xl font-bold tabular-nums">
                                    {formatKr((filteredContributions[filteredContributions.length - 1]?.totalHolidayPayAmount || 0) + (filteredContributions[filteredContributions.length - 1]?.totalBetaAmount || 0))}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.stats.totalContributions")}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.contributionsDev")}
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum} markeret
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] min-w-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={filteredContributions}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis className="text-xs" tickFormatter={(v) => `${v / 1000000}M`} />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            wrapperStyle={tooltipWrapperStyle}
                                            formatter={(value, name) => [
                                                formatKr(value as number),
                                                name === "totalHolidayPayAmount"
                                                    ? t("admin.validation.holidayPay")
                                                    : "BETA",
                                            ]}
                                        />
                                        <Legend
                                            formatter={(value) =>
                                                value === "totalHolidayPayAmount"
                                                    ? t("admin.validation.holidayPay")
                                                    : "BETA"
                                            }
                                        />
                                        {yearNum && (
                                            <ReferenceLine
                                                x={yearNum}
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                            />
                                        )}
                                        <Bar
                                            dataKey="totalHolidayPayAmount"
                                            name="totalHolidayPayAmount"
                                            fill="hsl(30, 80%, 55%)"
                                            radius={[0, 0, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="totalBetaAmount"
                                            name="totalBetaAmount"
                                            fill="hsl(280, 60%, 55%)"
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>År</TableHead>
                                    <TableHead className="text-right">{t("admin.validation.holidayPay")} (gns. %)</TableHead>
                                    <TableHead className="text-right">BETA (gns. %)</TableHead>
                                    <TableHead className="text-right">{t("admin.validation.holidayPay")} (total)</TableHead>
                                    <TableHead className="text-right">BETA (total)</TableHead>
                                    <TableHead className="text-right">Kontrakter</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredContributions.map((d) => (
                                    <TableRow
                                        key={d.year}
                                        className={yearNum === d.year ? "bg-primary/5 font-semibold" : ""}
                                    >
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.avgHolidayPayRate}%</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.avgBetaRate}%</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatKr(d.totalHolidayPayAmount)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatKr(d.totalBetaAmount)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.contractCount}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Per produktion */}
                    {contributionsByProduction.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm">Bidrag per produktion</CardTitle>
                                <p className="text-xs text-muted-foreground">
                                    Beregnet fra løn × arbejdsuger. Leverandørkontrakter betaler ikke helligdag/BETA — vist som 0.
                                </p>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Produktion</TableHead>
                                            <TableHead className="text-right">Uger</TableHead>
                                            <TableHead className="text-right">Løngrundlag</TableHead>
                                            <TableHead className="text-right">Helligdag (1%)</TableHead>
                                            <TableHead className="text-right">BETA (0,5%)</TableHead>
                                            <TableHead className="text-right">I alt</TableHead>
                                            <TableHead className="text-right">Type</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {contributionsByProduction.map(p => (
                                            <TableRow key={p.contractId} className={p.isFreelance ? "opacity-60" : ""}>
                                                <TableCell className="font-medium">{p.title}</TableCell>
                                                <TableCell className="text-right tabular-nums">{p.weeks}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatKr(p.totalSalary)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{p.isFreelance ? "—" : formatKr(p.holidayPay)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{p.isFreelance ? "—" : formatKr(p.beta)}</TableCell>
                                                <TableCell className="text-right tabular-nums font-semibold">
                                                    {p.isFreelance ? "—" : formatKr(p.holidayPay + p.beta)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Badge variant={p.isFreelance ? "outline" : "secondary"} className="text-[10px] font-normal">
                                                        {p.isFreelance ? "Lev." : "A-løn"}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {/* Totalrække */}
                                        <TableRow className="border-t-2 font-bold bg-muted/30">
                                            <TableCell>Total</TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {Math.round(contributionsByProduction.reduce((s, p) => s + p.weeks, 0) * 10) / 10}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatKr(contributionsByProduction.reduce((s, p) => s + p.totalSalary, 0))}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatKr(contributionsByProduction.reduce((s, p) => s + p.holidayPay, 0))}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatKr(contributionsByProduction.reduce((s, p) => s + p.beta, 0))}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatKr(contributionsByProduction.reduce((s, p) => s + p.holidayPay + p.beta, 0))}
                                            </TableCell>
                                            <TableCell />
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )}

                    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-4">
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                            <strong>Bemærk:</strong> Helligdagsbetaling (1%) og BETA-bidrag (0,5%) indbetales af producenten oveni A-lønnen. Leverandørkontrakter er undtaget. Satserne er baseret på De4-overenskomsten og udtrækkes fra kontrakterne ved validering.
                        </p>
                    </div>
                </TabsContent>

                {/* ── AI Clause Adoption ─────────────────────────── */}
                <TabsContent value="aiClause" className="mt-4 space-y-4">
                    {yearNum && (
                        <Badge variant="outline" className="gap-1">
                            <CalendarDays className="h-3 w-3" />
                            Data filtreret for {yearNum}
                        </Badge>
                    )}
                    <div className="hidden gap-4 sm:grid sm:grid-cols-3">
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-4xl font-bold">{aiStats.pct}%</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    af kontrakter har AI-forbehold
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-4xl font-bold text-emerald-600">
                                    {aiStats.withClause.length}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    med AI-klausul
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-4xl font-bold text-amber-600">
                                    {aiStats.withData.length - aiStats.withClause.length}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    uden AI-klausul
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                AI/Data mining forbehold pr. år
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] min-w-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={aiStats.chartData}>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            className="stroke-border"
                                        />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis className="text-xs" />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            wrapperStyle={tooltipWrapperStyle}
                                            formatter={(value, name) => [
                                                `${value} kontrakter`,
                                                name === "withClause"
                                                    ? "Med AI-klausul"
                                                    : "Uden AI-klausul",
                                            ]}
                                        />
                                        <Legend
                                            formatter={(value) =>
                                                value === "withClause"
                                                    ? "Med AI-klausul"
                                                    : "Uden AI-klausul"
                                            }
                                        />
                                        <Bar
                                            dataKey="withClause"
                                            stackId="a"
                                            fill="hsl(160, 50%, 50%)"
                                            radius={[0, 0, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="withoutClause"
                                            stackId="a"
                                            fill="hsl(var(--muted-foreground))"
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20 p-4">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                            <strong>Anbefaling:</strong> DFKS anbefaler at alle nye
                            kontrakter inkluderer en AI/data mining klausul for at
                            beskytte klipperens rettigheder i forbindelse med
                            automatiseret tekst- og dataudvinding.
                        </p>
                    </div>
                </TabsContent>

                {/* Indkomst */}
                {/* Antal kontrakter per år */}
                <TabsContent value="contractCount" className="mt-4 space-y-4">
                    {contractsPerYear.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">Ingen kontrakter med årsdata.</p>
                    ) : (
                        <>
                            {/* Overblik */}
                            <div className="hidden grid-cols-3 gap-4 sm:grid">
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">Kontrakter i alt</CardTitle></CardHeader>
                                    <CardContent><p className="text-3xl font-bold">{contractsPerYear.reduce((s, y) => s + y.total, 0)}</p></CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">A-lønskontrakter</CardTitle></CardHeader>
                                    <CardContent>
                                        <p className="text-3xl font-bold">{contractsPerYear.reduce((s, y) => s + y.aLoen, 0)}</p>
                                        <p className="text-xs text-muted-foreground">{Math.round(contractsPerYear.reduce((s, y) => s + y.aLoen, 0) / Math.max(contractsPerYear.reduce((s, y) => s + y.total, 0), 1) * 100)}% af total</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">Leverandørkontrakter</CardTitle></CardHeader>
                                    <CardContent>
                                        <p className="text-3xl font-bold">{contractsPerYear.reduce((s, y) => s + y.leverandoer, 0)}</p>
                                        <p className="text-xs text-muted-foreground">{Math.round(contractsPerYear.reduce((s, y) => s + y.leverandoer, 0) / Math.max(contractsPerYear.reduce((s, y) => s + y.total, 0), 1) * 100)}% af total</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Søjlediagram */}
                            <Card>
                                <CardHeader><CardTitle className="text-sm">Kontrakter per år</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="h-[300px] min-w-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={contractsPerYear}>
                                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                                <XAxis dataKey="year" className="text-xs" />
                                                <YAxis className="text-xs" allowDecimals={false} />
                                                <Tooltip contentStyle={tooltipStyle} wrapperStyle={tooltipWrapperStyle} />
                                                <Legend />
                                                <Bar dataKey="aLoen" name="A-løn" fill="hsl(210, 65%, 55%)" stackId="a" radius={[0,0,0,0]} />
                                                <Bar dataKey="leverandoer" name="Leverandør" fill="hsl(30, 70%, 55%)" stackId="a" radius={[4,4,0,0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Tabel */}
                            <div className="rounded-lg border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>År</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                            <TableHead className="text-right">A-løn</TableHead>
                                            <TableHead className="text-right">Leverandør</TableHead>
                                            <TableHead className="text-right">Lev. andel</TableHead>
                                            <TableHead className="text-right">Gns. per person</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {contractsPerYear.map(y => (
                                            <TableRow key={y.year}>
                                                <TableCell className="font-medium">{y.year}</TableCell>
                                                <TableCell className="text-right tabular-nums font-semibold">{y.total}</TableCell>
                                                <TableCell className="text-right tabular-nums">{y.aLoen}</TableCell>
                                                <TableCell className="text-right tabular-nums">{y.leverandoer}</TableCell>
                                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                                    {y.total > 0 ? `${Math.round(y.leverandoer / y.total * 100)}%` : "—"}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums font-medium">
                                                    {y.avgPerPerson}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </>
                    )}
                </TabsContent>

                <TabsContent value="editors" className="mt-4 space-y-6">
                    {/* Forbehold */}
                    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-4 py-3 space-y-1.5 text-xs text-blue-800 dark:text-blue-300">
                        <p className="font-semibold">Forbehold og metodenoter</p>
                        <ul className="space-y-1 list-disc pl-4 text-blue-700 dark:text-blue-400">
                            <li><strong>Datagrundlag:</strong> Kun validerede kontrakter med løn og arbejdsuger indgår. Kontrakter uden disse felter er udeladt.</li>
                            <li><strong>Årsfordeling:</strong> Kontrakter der spænder over to år fordeles forholdsmæssigt efter kalenderperiode — forudsætning om jævn arbejdsfordeling.</li>
                            <li><strong>A-løn vs. leverandør:</strong> Tallene er ikke direkte sammenlignelige — leverandørløn er alt-inklusiv (inkl. feriepenge og pension), A-løn er ikke.</li>
                            <li><strong>AI-udtræk:</strong> Løn og uger er udtrukket automatisk af AI. Fejl i udtræk påvirker beregningen. Kontroller datakilderne ved tvivl.</li>
                            <li><strong>Anonymisering:</strong> Klipper A, B, C... er sorteret fra højeste til laveste årsindkomst i det valgte år.</li>
                        </ul>
                    </div>

                    {/* Mand vs. Kvinde — side om side */}
                    {(incomeByGender.male.count > 0 || incomeByGender.female.count > 0) && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm">Gennemsnitlig årsindkomst — mand vs. kvinde</CardTitle>
                                <p className="text-xs text-muted-foreground">Baseret på ugeløn × faktiske arbejdsuger per kontrakt{yearNum ? ` i ${yearNum}` : ""}. Kun kontrakter med kønsinformation.</p>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-6">
                                    {[incomeByGender.male, incomeByGender.female].map(g => g.count > 0 && (
                                        <div key={g.label} className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold">{g.label}</span>
                                                <Badge variant="secondary" className="text-[10px]">{g.count} person{g.count !== 1 ? "er" : ""}</Badge>
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Gns. årsindkomst</span>
                                                    <span className="font-bold text-base">{formatKr(g.avgAnnual)}</span>
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Effektiv ugeløn</span>
                                                    <span className="tabular-nums">{formatKr(g.avgWeekly)}</span>
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Gns. uger per person</span>
                                                    <span className="tabular-nums">{g.avgWeeksPerPerson}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {incomeByGender.male.count > 0 && incomeByGender.female.count > 0 && (
                                    <div className={`mt-4 pt-4 border-t text-xs flex items-center gap-2 ${incomeByGender.male.avgAnnual > incomeByGender.female.avgAnnual ? "text-amber-700" : "text-emerald-700"}`}>
                                        <span className="font-medium">Løngab:</span>
                                        <span>
                                            {incomeByGender.male.avgAnnual > incomeByGender.female.avgAnnual
                                                ? `Mænd tjener ${formatKr(incomeByGender.male.avgAnnual - incomeByGender.female.avgAnnual)} mere per år i gennemsnit`
                                                : incomeByGender.female.avgAnnual > incomeByGender.male.avgAnnual
                                                    ? `Kvinder tjener ${formatKr(incomeByGender.female.avgAnnual - incomeByGender.male.avgAnnual)} mere per år i gennemsnit`
                                                    : "Ingen løngab"}
                                            {" "}({Math.round(Math.abs(incomeByGender.male.avgAnnual - incomeByGender.female.avgAnnual) / Math.max(incomeByGender.male.avgAnnual, incomeByGender.female.avgAnnual) * 100)}%)
                                        </span>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {editorIncome.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">Ingen løndata fundet — kontrakter skal have løn og antal uger.</p>
                    ) : (
                        <>
                            {/* ── Årsindtjening ── */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm">Årsindtjening per klipper</CardTitle>
                                    <p className="text-xs text-muted-foreground">Samlet bruttoindtjening baseret på ugeløn × arbejdsuger per kontrakt</p>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Klipper</TableHead>
                                                <TableHead className="text-right">Effektiv ugeløn</TableHead>
                                                <TableHead className="text-right">Total uger</TableHead>
                                                <TableHead className="text-right">Samlet</TableHead>
                                                <TableHead className="text-right">Type</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {editorIncome.map((e, i) => (
                                                <TableRow key={e.displayName} className={i === 0 ? "bg-emerald-50/50 dark:bg-emerald-950/10" : i === editorIncome.length - 1 && editorIncome.length > 1 ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}>
                                                    <TableCell className="font-medium">
                                                        {e.displayName}
                                                        {i === 0 && <Badge variant="secondary" className="ml-2 text-[10px]">Højest</Badge>}
                                                        {i === editorIncome.length - 1 && editorIncome.length > 1 && <Badge variant="outline" className="ml-2 text-[10px]">Lavest</Badge>}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">{formatKr(e.avgWeekly)}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{e.totalWeeks} uger</TableCell>
                                                    <TableCell className="text-right tabular-nums font-bold">{formatKr(e.totalEarnings)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Badge variant={e.isFreelance ? "outline" : "secondary"} className="text-[10px] font-normal">
                                                            {e.isFreelance ? "Lev." : "A-løn"}
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>

                            {/* ── A-løn vs Leverandør sammenligning ── */}
                            <Card className="border-amber-200 dark:border-amber-800">
                                <CardHeader>
                                    <CardTitle className="text-sm">A-løn vs. Leverandør — hvad mangler leverandøren?</CardTitle>
                                    <p className="text-xs text-muted-foreground">
                                        Leverandørkontrakter er alt-inklusiv. Klipperen betaler selv pension og feriepenge — og producenten betaler ikke helligdagsbetaling eller BETA-bidrag.
                                        Denne analyse viser den reelle forskel i lønomkostning.
                                    </p>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {editorIncome.map(e => {
                                        if (!e.isFreelance) return null
                                        // Leverandør beregning
                                        const gross = e.avgWeekly                              // inkl. personlige tillæg — til indkomstoversigt
                                        const grossBase = e.avgBaseWeekly                      // grundløn uden tillæg — til bidragsberegning
                                        const ferieBase = Math.round(gross / 1.125)            // feriepenge udgør 12,5% af feriebase (af total inkl. tillæg)
                                        const feriepenge = gross - ferieBase                   // hvad der "er" feriepenge i lønnen
                                        const pension = Math.round(grossBase * 0.095)          // 9,5% pension af grundløn (excl. tillæg)
                                        const helligdag = Math.round(grossBase * 0.01)         // 1% af grundløn
                                        const beta = Math.round(grossBase * 0.005)             // 0,5% af grundløn
                                        const mangler = feriepenge + pension + helligdag + beta
                                        const netAekvivalent = gross - mangler
                                        const de4Normallon = 14637
                                        const de4Total = de4Normallon + Math.round(de4Normallon * (0.095 + 0.01 + 0.005))
                                        return (
                                            <div key={e.displayName} className="rounded-lg border p-4 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-semibold">{e.displayName}</span>
                                                    <Badge variant="outline" className="text-[10px]">Leverandør {formatKr(gross)}/uge</Badge>
                                                </div>
                                                <div className="grid grid-cols-2 gap-4 text-xs">
                                                    <div className="space-y-1.5">
                                                        <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Hvad leverandøren "mangler"</p>
                                                        <div className="space-y-1">
                                                            {[
                                                                { label: "Feriepenge (12,5% inkl. i løn)", val: feriepenge },
                                                                { label: "Pension (9,5% — betaler selv)", val: pension },
                                                                { label: "Helligdagsbetaling (1% — prod. betaler ikke)", val: helligdag },
                                                                { label: "BETA-fond (0,5% — prod. betaler ikke)", val: beta },
                                                            ].map(r => (
                                                                <div key={r.label} className="flex justify-between text-muted-foreground">
                                                                    <span>{r.label}</span>
                                                                    <span className="text-destructive tabular-nums">−{formatKr(r.val)}</span>
                                                                </div>
                                                            ))}
                                                            <div className="flex justify-between font-semibold border-t pt-1">
                                                                <span>Reel A-løn-ækvivalent</span>
                                                                <span className="tabular-nums">{formatKr(netAekvivalent)}/uge</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Sammenligning med De4-normalløn</p>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Leverandør (reel ækvivalent)</span>
                                                                <span className="tabular-nums font-medium">{formatKr(netAekvivalent)}</span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">De4 normalløn (inkl. ydelser)</span>
                                                                <span className="tabular-nums font-medium">{formatKr(de4Total)}</span>
                                                            </div>
                                                            <div className={`flex justify-between font-semibold border-t pt-1 ${netAekvivalent >= de4Total ? "text-emerald-600" : "text-amber-600"}`}>
                                                                <span>Forskel</span>
                                                                <span className="tabular-nums">
                                                                    {netAekvivalent >= de4Total ? "+" : ""}{formatKr(netAekvivalent - de4Total)}/uge
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-muted-foreground pt-1">
                                                                Over {e.totalWeeks} uger = {formatKr(Math.abs(netAekvivalent - de4Total) * e.totalWeeks)} {netAekvivalent >= de4Total ? "mere" : "mindre"} end De4-overenskomst
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                    {editorIncome.every(e => !e.isFreelance) && (
                                        <p className="text-sm text-muted-foreground text-center py-4">Ingen leverandørkontrakter i det valgte udvalg.</p>
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    )
}
