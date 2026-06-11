/**
 * lib/resolveAnker.ts
 *
 * Robust PDF-highlighting på tværs af PDF.js-fragmentering.
 * Prioriteret strategi: direkte match → tal-prioritering → overrides → korteste unikke → for_generisk → ikke_fundet
 */

// ── Typer ─────────────────────────────────────────────────────────────────

export type AnkerMetode =
  | "direkte"
  | "tal_prioritering"
  | "override"
  | "trimmet"
  | "for_generisk"
  | "ikke_fundet"

export interface AnkerResultat {
  fundet: boolean
  anker: string
  original: string
  forekomster: number
  metode: AnkerMetode
  erBeløb: boolean
  fejltype?: "for_generisk" | "ikke_fundet"
  logData: {
    original: string
    forsøg: { kandidat: string; forekomster: number }[]
    valgt: string
  }
}

// ── Normalisering ─────────────────────────────────────────────────────────

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\r?\n/g, " ")                           // linjeskift → mellemrum
    .replace(/ /g, " ")                          // non-breaking space
    .replace(/[–—]/g, "-")                  // tankestreg → bindestreg
    .replace(/[“”‘’'′]/g, "'") // anførselstegn
    .replace(/ /g, " ")                          // thin space
    .replace(/ /g, " ")                          // narrow no-break space
    // PDF split-normalisering
    .replace(/(\w)-\s+(\w)/g, "$1$2")                // linjeskift-bindestreg: "ho-norar" → "honorar"
    .replace(/copy\s*-\s*dan/gi, "copydan")           // Copy-dan → copydan
    .replace(/(\d)\s+(\d)/g, "$1$2")                 // tal-split: "1 7,6" → "17,6"
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")           // tal/tal
    // Forkortelser
    .replace(/\bstk\.\s*/g, "stk ")
    .replace(/\bpkt\.\s*/g, "pkt ")
    .replace(/\bnr\.\s*/g, "nr ")
    // Formatering
    .replace(/_+/g, " ")                              // PDF-formular understregninger
    .replace(/\s+/g, " ")                             // dobbelt mellemrum
    .trim()
}

// ── ANKER_OVERRIDES — levende bibliotek ───────────────────────────────────

const ANKER_OVERRIDES: Record<string, string[]> = {
  // Generiske juridiske ord → specifikke varianter
  betaling:     ["betalingsbetingelser", "betalingsfrist", "betales senest", "betaling af honorar"],
  royalty:      ["royaltysats", "royaltybetaling", "royalty på", "royalty udgør", "royaltyprocent"],
  honorar:      ["honoraret udgør", "honorar på", "samlet honorar", "honorar er"],
  streaming:    ["streamingrettigheder", "svod", "online visning", "on demand", "svod platforme"],
  rettigheder:  ["rettighedsoverdragelse", "ophavsrettigheder", "samtlige rettigheder", "rettigheder til"],
  vederlag:     ["vederlaget udgør", "vederlag på", "samlet vederlag", "vederlagsret"],
  opsigelse:    ["opsigelsesvarsel", "opsiges med", "opsigelse af aftalen"],
  overenskomst: ["ikke omfattet af kollektive", "ikke er omfattet af overenskomst", "ingen overenskomst"],
  // Kendte PDF-split-varianter (normaliseres af norm() men listet for klarhed)
  "copy-dan":   ["copydan"],
  "ho-norar":   ["honorar"],
  "over-enskomst": ["overenskomst"],
  "op-havsret": ["ophavsret"],
  "strea-ming": ["streaming"],
}

// ── Tal-udtræk ────────────────────────────────────────────────────────────

function udtrækTal(s: string): string[] {
  // Match beløb og procenter — filtrer årstal og enkeltcifre
  const matches = s.match(/\d[\d.,]*\s*%?/g) ?? []
  return matches
    .map(m => norm(m).replace(/[.,\s%]/g, ""))
    .filter(m => {
      const n = parseInt(m, 10)
      return m.length >= 2 && !(n >= 1900 && n <= 2100) // ikke årstal
    })
}

function tælForekomster(kandidat: string, tekst: string): number {
  const n = norm(kandidat)
  if (!n || n.length < 2) return 0
  let count = 0
  let pos = 0
  while ((pos = tekst.indexOf(n, pos)) !== -1) { count++; pos++ }
  return count
}

// ── Hoved-funktion ────────────────────────────────────────────────────────

export function resolveAnker(aiStreng: string, kontraktTekst: string): AnkerResultat {
  const normTekst = norm(kontraktTekst)
  const normAnker = norm(aiStreng)
  const forsøg: { kandidat: string; forekomster: number }[] = []

  function prøv(kandidat: string): number {
    const n = norm(kandidat)
    const f = tælForekomster(n, normTekst)
    forsøg.push({ kandidat: n, forekomster: f })
    return f
  }

  function resultat(
    anker: string,
    forekomster: number,
    metode: AnkerMetode,
    erBeløb = false,
    fejltype?: "for_generisk" | "ikke_fundet"
  ): AnkerResultat {
    return {
      fundet: metode !== "ikke_fundet",
      anker: norm(anker),
      original: aiStreng,
      forekomster,
      metode,
      erBeløb,
      fejltype,
      logData: { original: aiStreng, forsøg, valgt: norm(anker) },
    }
  }

  // ── Trin 1: Direkte match ────────────────────────────────────────────────
  const direkte = prøv(normAnker)
  if (direkte === 1) return resultat(normAnker, 1, "direkte")

  // ── Trin 1b: Tal-prioritering ────────────────────────────────────────────
  const tal = udtrækTal(aiStreng)
  for (const t of tal) {
    const f = prøv(t)
    if (f === 1) return resultat(t, 1, "tal_prioritering", true)

    // Udvid med kontekst
    const ordFør = normAnker.split(t)[0]?.trim().split(" ").pop() ?? ""
    const ordEfter = normAnker.split(t)[1]?.trim().split(" ")[0] ?? ""

    if (ordFør) {
      const kandidat = `${ordFør} ${t}`
      const f2 = prøv(kandidat)
      if (f2 === 1) return resultat(kandidat, 1, "tal_prioritering", true)
    }
    if (ordEfter) {
      const kandidat = `${t} ${ordEfter}`
      const f3 = prøv(kandidat)
      if (f3 === 1) return resultat(kandidat, 1, "tal_prioritering", true)
    }
    if (ordFør && ordEfter) {
      const kandidat = `${ordFør} ${t} ${ordEfter}`
      const f4 = prøv(kandidat)
      if (f4 === 1) return resultat(kandidat, 1, "tal_prioritering", true)
    }
  }

  // ── Trin 2: ANKER_OVERRIDES ───────────────────────────────────────────────
  const nøgle = normAnker.split(" ")[0] // første ord
  const overrides = ANKER_OVERRIDES[nøgle] ?? ANKER_OVERRIDES[normAnker] ?? []
  for (const ov of overrides) {
    const f = prøv(ov)
    if (f === 1) return resultat(ov, 1, "override")
    if (f >= 1) { /* fortsæt — find bedre */ }
  }

  // ── Trin 3: Korteste unikke delstreng ────────────────────────────────────
  // Prøv progressivt kortere slices (ord-baseret)
  const ord = normAnker.split(" ").filter(Boolean)
  for (let len = ord.length - 1; len >= 3; len--) {
    for (let start = 0; start <= ord.length - len; start++) {
      const kandidat = ord.slice(start, start + len).join(" ")
      const f = prøv(kandidat)
      if (f === 1) return resultat(kandidat, 1, "trimmet")
    }
  }

  // ── Trin 4: For generisk (1+ forekomster) ────────────────────────────────
  if (direkte >= 1) {
    return resultat(normAnker, direkte, "for_generisk", false, "for_generisk")
  }

  // ── Trin 5: Ikke fundet ───────────────────────────────────────────────────
  return resultat(normAnker, 0, "ikke_fundet", false, "ikke_fundet")
}

// ── Batch-funktion ────────────────────────────────────────────────────────

export function resolveAlleAnkre(
  fund: { id: string; felt: string; kildeTekst: string }[],
  kontraktTekst: string
): (AnkerResultat & { id: string; felt: string })[] {
  return fund.map(f => ({
    ...resolveAnker(f.kildeTekst, kontraktTekst),
    id: f.id,
    felt: f.felt,
  }))
}

// ── Feedback-payload ──────────────────────────────────────────────────────

export function bygFeedbackPayload(
  resultat: AnkerResultat,
  highlightSucces: boolean,
  juristKorrektion?: string
): object {
  return {
    anker_original: resultat.original,
    anker_valgt: resultat.anker,
    anker_metode: resultat.metode,
    anker_forekomster: resultat.forekomster,
    highlight_succes: highlightSucces,
    jurist_korrektion: juristKorrektion ?? null,
    skal_tilfojes_overrides: !highlightSucces && !!juristKorrektion,
    log_data: JSON.stringify(resultat.logData),
  }
}

// ── Debug ─────────────────────────────────────────────────────────────────

export function debugAnker(aiStreng: string, kontraktTekst: string): void {
  const r = resolveAnker(aiStreng, kontraktTekst)
  console.group(`[resolveAnker] "${aiStreng}"`)
  console.log("Metode:", r.metode)
  console.log("Valgt anker:", r.anker)
  console.log("Forekomster:", r.forekomster)
  console.log("erBeløb:", r.erBeløb)
  if (r.fejltype) console.warn("Fejltype:", r.fejltype)
  console.table(r.logData.forsøg)
  console.groupEnd()
}
