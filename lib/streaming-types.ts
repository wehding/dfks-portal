// ── Streaming Rettighedsudbetaling ──────────────────────────
// Domænemodel for udbetalingsmodul via Create Denmark
// ────────────────────────────────────────────────────────────

// ── Enums ────────────────────────────────────────────────────

export type ProductionType =
    | "film_original"       // Film - Original
    | "film_licensed"       // Film - Licenseret
    | "tv_series_original"  // TV Serie - Original
    | "tv_series_licensed"  // TV Serie - Licenseret
    | "short_original"
    | "documentary_original"

export type LicenseDuration = 10 | 50 // år — licenseret = 10, original = 50

export type DistributionKeyStatus =
    | "draft"       // Oprettet af DFKS, ingen forslag endnu
    | "proposed"    // En klipper har foreslået en nøgle
    | "negotiating" // Modforslag er fremsat
    | "accepted"    // Alle klippere har accepteret
    | "locked"      // DFKS har låst (efter accept) — kan ikke ændres

export type PayoutStatus =
    | "pending"     // Beløb modtaget fra Create Denmark, afventer fordeling
    | "distributing"// Fordeling beregnet, afventer udbetaling
    | "exported"    // Udbetalingstekst genereret og eksporteret til lønsystem
    | "paid"        // Udbetalt og bekræftet

// ── Produktioner ─────────────────────────────────────────────

/**
 * En streamingproduktion som Create Denmark udbetaler vederlag for.
 * Svarer til én sektion i Excel-arket "Beregninger".
 */
export interface StreamingProduction {
    id: string
    productionNumber: string        // "001", "002" etc.
    title: string
    type: ProductionType
    premiereYear: number
    licenseDurationYears: LicenseDuration
    licenseStartYear: number
    adminFeePercent: number         // Administrationsprocent for denne produktion
    platform?: string               // Platform/distributør (f.eks. "Netflix", "DR")
    season?: number                 // Sæsonnummer (valgfrit — kun relevant for serier)
    notes?: string
    createdAt: string
    updatedAt: string
    createdBy: string               // admin userId
}

/**
 * En klippers tilknytning til en produktion.
 * Svarer til én række i klipperlisten i Excel.
 */
export interface ProductionEditor {
    id: string
    productionId: string
    userId: string                  // Hvis klipperen er bruger i portalen
    name: string                    // Navn (kan udfyldes manuelt hvis ikke bruger)
    email?: string                  // Til notifikationer
    birthDate?: string              // DDMMYY format som i Excel
    episodes?: string               // "1, 4" eller "3.6" etc.
    contractUrl?: string            // Google Drive link til kontrakt
    addedAt: string
    addedBy: string                 // admin userId
}

// ── Fordelingsnøgle ──────────────────────────────────────────

/**
 * En fordelingsnøgle for en produktion i et givet udbetalingsår.
 * Én produktion kan have én aktiv nøgle ad gangen.
 * Nøglen låses når alle klippere har accepteret.
 */
export interface DistributionKey {
    id: string
    productionId: string
    payoutYear: number              // Det år udbetalingen vedrører
    status: DistributionKeyStatus
    proposedBy: string              // userId på den klipper der foreslog nøglen
    proposedAt: string
    lockedAt?: string               // Tidspunkt for DFKS-låsning
    lockedBy?: string               // admin userId
    documentUrl?: string            // Link til evt. ekstern aftale/PDF
    notes?: string                  // Intern note fra DFKS
    shares: DistributionShare[]
}

/**
 * En enkelt klipper andel i en fordelingsnøgle.
 */
export interface DistributionShare {
    id: string
    distributionKeyId: string
    editorId: string                // ProductionEditor.id
    userId?: string                 // Portal-bruger hvis tilknyttet
    name: string
    sharePercent: number            // 0-100, sum skal = 100
    acceptedAt?: string
    acceptedByUserId?: string
    rejectedAt?: string
    rejectionReason?: string
    counterProposal?: number        // Foreslået alternativ andel %
}

/**
 * En hændelse i fordelingsnøglens audit trail.
 * Bruges til at dokumentere processen (erstatter mail-tråden).
 */
export interface DistributionKeyEvent {
    id: string
    distributionKeyId: string
    type:
        | "proposed"            // Nøgle foreslået
        | "accepted"            // Klipper accepterede
        | "rejected"            // Klipper afviste
        | "counter_proposed"    // Modforslag fremsat
        | "revised"             // Nøgle revideret
        | "locked"              // DFKS låste nøglen
        | "comment"             // Kommentar tilføjet
    actorUserId: string
    actorName: string
    payload?: {
        sharePercent?: number
        counterPercent?: number
        comment?: string
        previousShares?: { name: string; percent: number }[]
        newShares?: { name: string; percent: number }[]
    }
    createdAt: string
}

// ── Udbetalinger ─────────────────────────────────────────────

/**
 * En udbetaling fra Create Denmark til en produktion for ét år.
 * Svarer til én "Udbetaling for ÅÅÅÅ"-kolonne i Excel.
 */
export interface StreamingPayout {
    id: string
    productionId: string
    distributionKeyId: string       // Den fordelingsnøgle der bruges
    payoutYear: number
    type: "irf" | "succesbetaling" | "royalties" | "copydan"
    payer?: string                  // Udfyldes ved royalties (producentnavn)
    grossAmount: number             // Modtaget beløb inkl. adm.
    adminFeePercent: number         // Fra produktionens adminFeePercent
    adminFeeAmount: number          // Beregnet: grossAmount × adminFeePercent / (100 + adminFeePercent)
    netAmount: number               // Til fordeling: grossAmount - adminFeeAmount
    status: PayoutStatus
    receivedAt: string              // Hvornår DFKS registrerede beløbet
    exportedAt?: string
    exportedBy?: string             // admin userId
    paidAt?: string
    notes?: string
    distributions: PayoutEditorDistribution[]
}

/**
 * En enkelt klippers andel af en konkret udbetaling.
 */
export interface PayoutEditorDistribution {
    id: string
    payoutId: string
    editorId: string
    userId?: string
    name: string
    sharePercent: number            // Kopieret fra DistributionShare ved eksport
    grossAmount: number             // netAmount × sharePercent / 100
    payoutText?: string             // Genereret tekst til lønsystem
}

// ── Udnyttelse ────────────────────────────────────────────────

export type ExploitationType = "streaming" | "broadcast" | "royalties" | "copydan"

/**
 * En konkret udnyttelse af et værk — én aftale med én platform/kilde.
 * Et værk kan have flere udnyttelser (Netflix, DR, Copydan osv.)
 */
export interface Exploitation {
    id: string
    productionId: string
    platform: string            // "Netflix", "DR", "Copydan" etc.
    type: ExploitationType
    payer?: string              // Udfyldes ved royalties (producentnavn)
    notes?: string
    createdAt: string
}

/**
 * En betaling under en specifik udnyttelse.
 */
export interface ExploitationPayout {
    id: string
    exploitationId: string
    payoutYear: number
    type: "irf" | "succesbetaling" | "betaling"
    grossAmount: number
    adminFeePercent: number
    adminFeeAmount: number
    netAmount: number
    status: PayoutStatus
    receivedAt: string
    exportedAt?: string
    paidAt?: string
    notes?: string
    distributions: PayoutEditorDistribution[]
}

// ── Eksport ───────────────────────────────────────────────────

/**
 * En eksporteret udbetalingstekst klar til lønsystem.
 */
export interface PayoutExport {
    id: string
    payoutId: string
    productionTitle: string
    payoutYear: number
    exportedAt: string
    exportedBy: string
    lines: PayoutExportLine[]
}

export interface PayoutExportLine {
    editorName: string
    cprNumber?: string              // Fra User.cprNumber hvis tilgængeligt
    amount: number
    description: string            // F.eks. "SVOD-vederlag Kærlighed for voksne 2023"
    paymentType: "svod_royalty" | "copydan" | "other"
}

// ── Notifikationer ────────────────────────────────────────────

export type StreamingNotificationType =
    | "distribution_key_proposed"   // Ny nøgle foreslået — alle klippere notificeres
    | "distribution_key_accepted"   // En klipper accepterede
    | "distribution_key_locked"     // Nøglen er låst — klar til udbetaling
    | "payout_registered"           // DFKS har registreret et beløb
    | "payout_exported"             // Udbetalingstekst genereret

export interface StreamingNotification {
    id: string
    type: StreamingNotificationType
    productionId: string
    productionTitle: string
    recipientUserId: string
    read: boolean
    createdAt: string
    payload?: Record<string, unknown>
}

/**
 * Global indstilling for administrationsprocenter på udbetalinger.
 * Gælder fremadrettet — ældre udbetalinger beholder deres egen sats.
 */
export interface StreamingAdminFees {
    linked: boolean                 // true = alle typer bruger samme sats
    irf: number
    succesbetaling: number
    royalties: number
    copydan: number
}

export interface StreamingSettings {
    adminFees: StreamingAdminFees
    updatedAt: string
    updatedBy: string
}

// ── Aftalelicens ──────────────────────────────────────────────

export type AftalelicensKilde = "copydan_verdenstv" | "copydan_arkiv" | "tv2play"

export type VaerkType =
    | "spillefilm"
    | "tv_serie_lang"       // > 30 min per episode
    | "tv_serie_kort"       // <= 30 min per episode
    | "kortfilm"
    | "dokumentarfilm"
    | "dokumentarserie"
    | "dokuDrama"
    | "kort_dokumentar"

export type SortStatus = "pending" | "approved" | "rejected" | "flagged"

// Filtreringsregel — konfigureres i stamdata
export interface FilterRule {
    id: string
    name: string            // Beskrivende navn, f.eks. "Fjern sportsindhold"
    type: "title_keyword" | "title_regex" | "channel"
    value: string           // Nøgleord, regex eller kanalnavn
    active: boolean
    createdAt: string
}

// Vægt-konfiguration per værktype — point pr. værk
export interface VaerkVaegt {
    type: VaerkType
    label: string
    weight: number          // Point pr. værk (fast beløb, ikke faktor × minutter)
}

// Genudsendelse-faktor
export interface GenudsendelseFaktor {
    label: string           // "Premiere" / "Genudsendelse (inden for 1 måned)"
    isGenudsendelse: boolean
    factor: number          // F.eks. 1.0 for premiere, 0.5 for genudsendelse
}

// Ekstra konfiguration: dokumentarfilm-tiers og supplerende klip
export interface AftalelicensVaegtExtra {
    // Dokumentarfilm: tre niveauer baseret på varighed
    dokLangPoints: number       // ≥ dokLangMin min → default 200
    dokMellemPoints: number     // dokMellemMin–dokLangMin min → default 150
    dokKortPoints: number       // < dokMellemMin min → default 100
    dokLangMin: number          // Grænse for "lang" dokumentar: default 61 min
    dokMellemMin: number        // Grænse for "mellemlang" dokumentar: default 21 min
    // Dokumentarserie tier (afsnitsvarighed)
    dokSerieLangMin: number     // Min. varighed for "tung seriedok.": default 38 min
    dokSerieKortPoints: number  // < dokSerieLangMin → default 50
    // Supplerende klip (B-klippere)
    supplerendeKlipFaktor: number   // Faktor for B-klippere: default 0.3
}

// En importeret batch af rådata
export interface AftalelicensBatch {
    id: string
    kilde: AftalelicensKilde
    year: number
    uploadedAt: string
    uploadedBy: string
    totalRows: number
    filteredRows: number    // Tilbage efter automatisk filtrering
    status: "imported" | "sorting" | "weighted" | "completed"
    notes?: string
}

// En enkelt titel/visning efter filtrering
export interface AftalelicensVaerk {
    id: string
    batchId: string
    rawTitle: string        // Original titel fra kildedata
    normalizedTitle?: string // Normaliseret/renset titel
    channel?: string
    broadcastDate?: string
    duration?: number       // Minutter
    viewCount?: number      // TV2 Play: antal visninger
    season?: number         // Sæsonnummer (fx 3)
    episode?: number        // Afsnitsnummer (fx 7)
    productionYear?: number // Produktionsår
    isGenudsendelse?: boolean
    vaerkType?: VaerkType
    sortStatus: SortStatus
    sortedBy?: string       // userId
    sortedAt?: string
    dfiMatched?: boolean    // Om DFI-opslag er foretaget
    dfiData?: {
        title: string
        duration: number
        year: number
        category: string
        directors?: string[]
        editors?: string[]
    }
    notes?: string
}

// Tilknytning af rettighedshaver til et aftalelicens-værk
export interface AftalelicensRettighed {
    id: string
    vaerkId: string
    userId?: string
    name: string
    sharePercent: number
    contractVerified: boolean
}

// Vægtning og beregning
export interface AftalelicensVaegtet {
    vaerkId: string
    rawTitle: string
    vaerkType: VaerkType
    duration: number
    viewCount?: number
    isGenudsendelse: boolean
    points: number          // Beregnet: vaegt × duration/factor × genudsendelse
    shareOfTotal: number    // Denne titels andel af total points (0-1)
    estimatedAmount?: number // Ved prøveberegning: beregnet beløb
}

// Prøveberegning
export interface ProveBeregning {
    batchId: string
    klumpBeloeb: number     // Det beløb der skal fordeles
    adminFeePercent: number
    netBeloeb: number
    vaerker: AftalelicensVaegtet[]
    perKlipper: {
        userId?: string
        name: string
        totalPoints: number
        sharePercent: number
        amount: number
        vaerker: { title: string; points: number; amount: number }[]
    }[]
}

/**
 * Samlet overblik over en produktion til admin-dashboardet.
 * Beregnet view — ikke gemt i DB.
 */
// ── Oversigt / Dashboard ─────────────────────────────────────
export interface ProductionOverview {
    production: StreamingProduction
    editors: ProductionEditor[]
    activeDistributionKey?: DistributionKey
    payouts: StreamingPayout[]
    totalReceived: number           // Sum af alle grossAmount
    totalDistributed: number        // Sum af alle netAmount der er exported/paid
    totalAdminFee: number
    pendingPayouts: number          // Antal afventende udbetalinger
    licenseYearsRemaining: number
}

/**
 * En enkelt klippers samlede udbetalingsoverblik — til klipper-portalen.
 */
export interface EditorPayoutSummary {
    productionId: string
    productionTitle: string
    productionType: ProductionType
    premiereYear: number
    sharePercent?: number           // Aktuel andel i låst nøgle
    payouts: {
        year: number
        type: "irf" | "succesbetaling"
        amount: number
        status: PayoutStatus
        paidAt?: string
    }[]
    totalReceived: number
    pendingAmount: number
    distributionKeyStatus?: DistributionKeyStatus
    myAcceptStatus?: "accepted" | "rejected" | "pending"
}
