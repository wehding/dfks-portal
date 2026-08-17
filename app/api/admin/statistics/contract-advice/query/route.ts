import { NextRequest, NextResponse } from "next/server";

import { requireStaffModuleApi } from "@/lib/api-auth";
import { getContractAdviceStatistics } from "@/lib/contract-advice-statistics";

export const dynamic = "force-dynamic";

const RULES: Array<[RegExp, string, string]> = [
  [/pension/i, "pension", "pension"], [/copydan/i, "copydan", "Copydan-forbehold"],
  [/(streaming|svod)/i, "svod", "streamingforbehold"], [/overenskomst/i, "overenskomst", "overenskomsthenvisning"],
  [/underskrift|signatur/i, "underskrift", "underskrift"], [/feriepenge/i, "feriepenge", "feriepenge"],
  [/krediter/i, "kreditering", "kreditering"], [/(tdm|data.?mining|ai.forbehold)/i, "tdm_ai", "TDM-/AI-forbehold"],
];

export async function POST(request: NextRequest) {
  const auth = await requireStaffModuleApi("advice_statistics", "read");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (question.length < 5) return NextResponse.json({ error: "Skriv et spørgsmål på mindst fem tegn." }, { status: 400 });
  const rule = RULES.find(([pattern]) => pattern.test(question));
  const wantsTime = /(svartid|behandlingstid|hvor lang|tid til svar)/i.test(question);
  const wantsCorrections = /(rettet|rettelse|ændret|ny version)/i.test(question);
  const wantsCases = /(antal|hvor mange|sager)/i.test(question);
  if (!rule && !wantsTime && !wantsCases) {
    return NextResponse.json({ error: "Spørgsmålet kunne ikke matches med et godkendt rådgivningsmål. Spørg fx til sager, svartid, overenskomst, pension eller rettelser." }, { status: 422 });
  }
  try {
    const data = await getContractAdviceStatistics(auth.orgId, { ruleCodes: rule ? [rule[1]] : [] });
    if (data.suppressed) return NextResponse.json({ answer: `Datagrundlaget er under organisationens anonymitetsgrænse på ${data.minimum}.` });
    if (wantsTime) {
      const seconds = data.workflow?.medianResponseSeconds;
      return NextResponse.json({ answer: seconds == null ? "Der er endnu ikke nok afsluttede svar til at beregne en median." : `Medianen fra modtagelse til første svar er ${seconds < 86400 ? `${Math.round(seconds / 3600 * 10) / 10} timer` : `${Math.round(seconds / 8640) / 10} dage`}.` });
    }
    if (wantsCorrections && rule) {
      const row = data.corrections?.find(item => item.ruleCode === rule[1]);
      return NextResponse.json({ answer: !row?.compared ? `Der er endnu ingen sikre versionssammenligninger for ${rule[2]}.` : `${rule[2]} er rettet i ${row.fixed} af ${row.compared} sammenlignede versioner. ${row.uncertain} sammenligninger er usikre.` });
    }
    if (rule) {
      const row = data.issueFrequency?.find(item => item.ruleCode === rule[1]);
      return NextResponse.json({ answer: row ? `${rule[2]} er registreret som et problem i ${row.count} sager, svarende til ${row.sharePercent} % af de viste rådgivningssager.` : `Der er ingen synlige fund for ${rule[2]} med de aktuelle anonymitetsregler.` });
    }
    return NextResponse.json({ answer: `Der er ${data.caseCount ?? 0} rådgivningssager i det synlige, anonymiserede datagrundlag.` });
  } catch (error) {
    console.error("[contract-advice-query] Query failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Rådgivningsstatistikken kunne ikke beregnes." }, { status: 500 });
  }
}
