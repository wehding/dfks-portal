"use client"

import { useState } from "react"

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
    <div style={{ position: "relative", display: "inline-block" }}>

      {/* Trigger-knap */}
      <button
        onClick={() => setAaben(v => !v)}
        title="Sådan skriver du gode noteringer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          fontSize: 12,
          color: aaben ? "#1d4ed8" : "#6b7280",
          background: aaben ? "#eff6ff" : "transparent",
          border: `1px solid ${aaben ? "#bfdbfe" : "#e5e7eb"}`,
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 14 }}>💡</span>
        Sådan skriver du gode noteringer
        <span style={{
          fontSize: 10,
          transform: aaben ? "rotate(180deg)" : "none",
          transition: "transform 0.2s",
          display: "inline-block",
        }}>▼</span>
      </button>

      {/* Guide-panel */}
      {aaben && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          width: 480,
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
          zIndex: 1000,
          overflow: "hidden",
          fontFamily: "Arial, sans-serif",
        }}>

          {/* Header */}
          <div style={{
            padding: "14px 18px",
            background: "#eff6ff",
            borderBottom: "1px solid #dbeafe",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1e40af" }}>
                Guide til AI-noteringer
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#3b82f6" }}>
                Sådan instruerer du AI&apos;en præcist
              </p>
            </div>
            <button
              onClick={() => setAaben(false)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 18, color: "#93c5fd", lineHeight: 1,
              }}
            >×</button>
          </div>

          {/* Navigations-tabs */}
          <div style={{
            display: "flex",
            overflowX: "auto",
            borderBottom: "1px solid #f3f4f6",
            padding: "0 4px",
            gap: 2,
          }}>
            {GUIDE_SECTIONS.map((s, i) => (
              <button
                key={i}
                onClick={() => setAktivSektion(i)}
                style={{
                  padding: "8px 10px",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${aktivSektion === i ? "#2563eb" : "transparent"}`,
                  color: aktivSektion === i ? "#2563eb" : "#6b7280",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: aktivSektion === i ? 600 : 400,
                }}
              >
                {s.ikon} {s.titel.split("—")[0].trim().split(" ").slice(0, 3).join(" ")}
              </button>
            ))}
          </div>

          {/* Indhold */}
          <div style={{ padding: "16px 18px" }}>
            <p style={{
              margin: "0 0 10px",
              fontSize: 13,
              fontWeight: 700,
              color: "#1f2937",
            }}>
              {GUIDE_SECTIONS[aktivSektion].ikon} {GUIDE_SECTIONS[aktivSektion].titel}
            </p>
            <pre style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.7,
              color: "#374151",
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              background: "#f9fafb",
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid #f3f4f6",
            }}>
              {GUIDE_SECTIONS[aktivSektion].indhold}
            </pre>
          </div>

          {/* Navigation */}
          <div style={{
            padding: "10px 18px",
            borderTop: "1px solid #f3f4f6",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <button
              onClick={() => setAktivSektion(v => Math.max(0, v - 1))}
              disabled={aktivSektion === 0}
              style={{
                fontSize: 12, padding: "5px 10px",
                background: "none", border: "1px solid #e5e7eb",
                borderRadius: 6, cursor: aktivSektion === 0 ? "not-allowed" : "pointer",
                color: aktivSektion === 0 ? "#d1d5db" : "#374151",
                fontFamily: "inherit",
              }}
            >← Forrige</button>

            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              {aktivSektion + 1} / {GUIDE_SECTIONS.length}
            </span>

            <button
              onClick={() => setAktivSektion(v => Math.min(GUIDE_SECTIONS.length - 1, v + 1))}
              disabled={aktivSektion === GUIDE_SECTIONS.length - 1}
              style={{
                fontSize: 12, padding: "5px 10px",
                background: aktivSektion === GUIDE_SECTIONS.length - 1 ? "none" : "#2563eb",
                border: "1px solid " + (aktivSektion === GUIDE_SECTIONS.length - 1 ? "#e5e7eb" : "#2563eb"),
                borderRadius: 6,
                cursor: aktivSektion === GUIDE_SECTIONS.length - 1 ? "not-allowed" : "pointer",
                color: aktivSektion === GUIDE_SECTIONS.length - 1 ? "#d1d5db" : "white",
                fontFamily: "inherit",
              }}
            >Næste →</button>
          </div>
        </div>
      )}
    </div>
  )
}
