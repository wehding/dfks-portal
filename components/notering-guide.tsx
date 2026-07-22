"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// ─── Indhold ─────────────────────────────────────────────────────────────────

const GUIDE_SECTIONS = [
  {
    titel: "Skriv til AI'en — ikke til dig selv",
    ikon: "🤖",
    indhold: `En notering bruges af AI'en som instruktion. Skriv derfor som om du briefer en ny medarbejder der ikke ved noget om emnet fra starten.

Dårligt eksempel:
"Det skal altid italesættes"

Godt eksempel:
"Kontrakten skal altid have et Copydan-forbehold. Hvis det mangler skal det kommenteres og følgende standardklausul foreslås tilføjet: [tekst]"`,
  },
  {
    titel: "En god notering har tre dele",
    ikon: "📋",
    indhold: `1. HVAD skal AI'en tjekke?
   Fx: "Tjek altid om kontrakten indeholder et Copydan-forbehold."

2. HVORNÅR skal den reagere?
   Fx: "Hvis forbeholdet mangler..."
   Fx: "Hvis producenten ikke er overenskomstdækket..."

3. HVAD skal den gøre/sige?
   Fx: "...skal følgende standardklausul foreslås tilføjet: [præcis tekst]"

Jo mere præcis, jo bedre — AI'en gætter ikke.`,
  },
  {
    titel: "Prioritet: Baggrund vs. Altid",
    ikon: "🔀",
    indhold: `ALTID: Noteringen aktiveres i ALLE analyser uanset kontrakttype.
Brug til: Copydan-forbehold, AI-klausul, royalty-tjek.

BAGGRUND: Noteringen bruges som kontekst men kommenteres ikke direkte.
Brug til: generel brancheviden, fortolkningsprincipper, DFKS-holdninger.

Vær tilbageholdende med ALTID — for mange ALTID-noteringer giver
støjende analyser der nævner det samme i hver mail.`,
  },
  {
    titel: "Standardklausuler — skriv dem præcist ind",
    ikon: "📝",
    indhold: `Når noteringen skal foreslå en konkret kontrakttekst, skriv den
ordret ind i noteringen — ikke en beskrivelse af den.

Dårligt:
"Foreslå at tilføje Copydan-standardklausulen"

Stadig dårligt — selvom teksten er med:
"Foreslå at tilføje en klausul om at klipperen forbeholder sig
ret til individuelt vederlag via Copydan for TV-visning..."
(AI'en omskriver og forkorter — og mister den juridiske præcision)

Korrekt:
'Foreslå PRÆCIS denne tekst — ingen omskrivning, brug ordret:
"Filmklipperen og Producenten bevarer, desuagtet øvrige
aftalevilkår, hver deres rettigheder samt en vederlagsret for
brug af Produktionen omfattet af Ophavsretslovens §§ 13, 13a,
17, 30a, 35, 39-46a og 50, stk. 2..."'

De tre nøgleord der virker: PRÆCIS, ingen omskrivning, brug ordret.
AI'en respekterer eksplicitte forbud mod omformulering — men kun
når det er skrevet direkte og tydeligt i noteringen.`,
  },
  {
    titel: "Brug gyldig_fra og gyldig_til",
    ikon: "📅",
    indhold: `Tidsbegrænsede noteringer bruges til kampagner og særlige indsatser.

Eksempel: "Alle kontrakter frem til 1. januar skal tjekkes for AI-klausul"
→ Sæt gyldig_fra = i dag, gyldig_til = 31-12-2026

Noteringen deaktiveres automatisk på gyldig_til-datoen.

Brug Aktiv-toggle til at pause en notering midlertidigt
uden at slette den.`,
  },
  {
    titel: "Test din notering",
    ikon: "🧪",
    indhold: `Upload en kontrakt der mangler det noteringen dækker og tjek:

✓ Kommenterer AI'en punktet i analysen?
✓ Er formuleringen naturlig og præcis?
✓ Foreslår den den rigtige standardklausul?

Hvis ikke — præcisér body-teksten. Typisk skyldes det at
instruktionen er for vag eller at standardklausulen mangler.`,
  },
]

// ─── Komponent ────────────────────────────────────────────────────────────────

export default function NoteringGuide() {
  const [aaben, setAaben] = useState(false)
  const [aktivSektion, setAktivSektion] = useState(0)

  return (
    <Popover open={aaben} onOpenChange={setAaben}>
      <PopoverTrigger asChild><button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true">💡</span>Sådan skriver du gode noteringer<span aria-hidden="true" className={`text-[10px] transition-transform ${aaben ? "rotate-180" : ""}`}>▼</span></button></PopoverTrigger>
      <PopoverContent id="notering-guide-panel" align="end" className="w-[min(480px,calc(100vw-32px))] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b bg-muted px-4 py-3"><div><p className="text-sm font-bold">Guide til AI-noteringer</p><p className="text-xs text-primary">Sådan instruerer du AI&apos;en præcist</p></div><button type="button" onClick={() => setAaben(false)} aria-label="Luk guide til AI-noteringer" className="rounded p-1 text-lg text-muted-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-ring">×</button></div>
        <div role="tablist" aria-label="Afsnit i guiden" className="flex gap-0.5 overflow-x-auto border-b px-1">{GUIDE_SECTIONS.map((section, index) => <button type="button" role="tab" aria-selected={aktivSektion === index} key={section.titel} onClick={() => setAktivSektion(index)} className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-xs focus-visible:ring-2 focus-visible:ring-ring ${aktivSektion === index ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground"}`}>{section.ikon} {section.titel.split("—")[0].trim().split(" ").slice(0, 3).join(" ")}</button>)}</div>
        <div role="tabpanel" className="p-4"><p className="mb-2 text-sm font-bold">{GUIDE_SECTIONS[aktivSektion].ikon} {GUIDE_SECTIONS[aktivSektion].titel}</p><pre className="whitespace-pre-wrap rounded-lg border bg-muted p-3 font-sans text-xs leading-relaxed text-foreground">{GUIDE_SECTIONS[aktivSektion].indhold}</pre></div>
        <div className="flex items-center justify-between border-t px-4 py-2.5"><button type="button" onClick={() => setAktivSektion(value => Math.max(0, value - 1))} disabled={aktivSektion === 0} className="rounded-md border px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring">← Forrige</button><span className="text-xs text-muted-foreground">{aktivSektion + 1} / {GUIDE_SECTIONS.length}</span><button type="button" onClick={() => setAktivSektion(value => Math.min(GUIDE_SECTIONS.length - 1, value + 1))} disabled={aktivSektion === GUIDE_SECTIONS.length - 1} className="rounded-md border border-primary bg-primary px-2.5 py-1.5 text-xs text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">Næste →</button></div>
      </PopoverContent>
    </Popover>
  )
}
