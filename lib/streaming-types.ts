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
