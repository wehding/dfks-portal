// ── Core Enums ──────────────────────────────────────────────

export type Category =
    | "feature"
    | "short"
    | "tvSeries"
    | "documentary"
    | "docSeries"
    | "tvEntertainment"
    | "reality"
    | "sport"

export type ContractStatus = "pending" | "review" | "approved" | "rejected"

export type SalaryUnit = "monthly" | "weekly" | "daily" | "total"

export type PaymentSource = "svod" | "copydan" | "royalties"

export type Gender = "male" | "female" | "other"

// ── Episodes (for series) ───────────────────────────────────

export interface Episode {
    number: number
    title: string
    duration: number // minutes
}

// ── Rights ──────────────────────────────────────────────────

export interface RightsReservation {
    svod: boolean
    copydan: boolean
    royalty: boolean
    royaltyPercent?: number
}

// ── Domain Models ───────────────────────────────────────────

export interface NextOfKin {
    name: string
    relation: string
    phone?: string
    email?: string
    notes?: string
}

export interface UserAddress {
    street: string
    postalCode: string
    city: string
}

export interface User {
    id: string
    name: string
    email: string
    phone?: string
    cprNumber?: string // masked, e.g. "010185-****"
    address?: UserAddress
    nextOfKin?: NextOfKin
    role: "member" | "admin"
    status: "active" | "inactive" | "pending"
    memberSince: string
    avatarUrl?: string
}

export interface EpisodeCredit {
    number: number
    role: string
}

export interface Contract {
    id: string
    userId: string
    userName?: string
    title: string
    category: Category
    creditedRoles: string[]
    duration: number // minutes (total or per episode)
    episodes?: Episode[]
    episodeCredits?: EpisodeCredit[] // per-episode role assignment (for series)
    premiereDate: string
    premiereYear: number
    fileUrl: string
    status: ContractStatus
    uploadedAt: string
    extractedData?: ExtractedContractData
}

export interface ExtractedContractData {
    productionType?: string
    salary?: number
    salaryUnit?: SalaryUnit
    startDate?: string
    endDate?: string
    producerName?: string
    pensionPercent?: number
    pensionSupplement?: number
    personalSupplement?: number
    otherSupplements?: string
    workingWeeks?: number
    svod: boolean
    copydan: boolean
    royalty: boolean
    royaltyPercent?: number
    aiDataMiningClause: boolean
    distribution?: string[]
    collectiveAgreement: boolean
    collectiveAgreementName?: string
    collectiveAgreementByReference?: boolean  // overenskomst inkorporeret ved reference i leverandørkontrakt
    isFreelanceContract?: boolean             // leverandørkontrakt med CVR
    gender?: Gender
    holidayPayRate?: number // Helligdagsbetaling percentage
    betaRate?: number // BETA (barselsfonden) percentage
    specialNotes?: string
}

export interface Work {
    id: string
    title: string
    creditedRoles: string[]
    sharedCredit: boolean
    sharedWith?: string[] // names of other credited users
    duration: number
    episodes?: Episode[]
    editedEpisodes?: number[] // episode numbers this user has edited
    contractId: string
    category: Category
    premiereYear: number
    rights: RightsReservation
}

// Represents a known work in the system (for matching)
export interface RegisteredWork {
    id: string
    title: string
    category: Category
    premiereYear: number
    registeredBy: string[] // user names who have contracts for this
}

export interface Payment {
    id: string
    workId: string
    workTitle: string
    source: PaymentSource
    amount: number
    adminFeePercent: number
    adminFee: number
    netAmount: number
    paidAt: string
}

export interface PayoutDistribution {
    userId: string
    userName: string
    sharePercent: number
    amount: number
}

export interface Payout {
    id: string
    workId: string
    workTitle: string
    poolAmount: number
    adminFee: number
    distributions: PayoutDistribution[]
    createdAt: string
    exported: boolean
}

export interface MasterDataItem {
    id: string
    name: string
    active: boolean
    meta?: string   // Valgfrit ekstra felt, fx standard licensperiode for produktionstyper
}

// ── Settings ────────────────────────────────────────────────

export interface PortalSettings {
    adminFeePercent: number
}

// ── Stats ───────────────────────────────────────────────────

export interface SalaryDataPoint {
    year: number
    dailyRate: number
    monthlyRate: number
}

export interface RightsClauseStats {
    category: string
    svodPercent: number
    copydanPercent: number
    royaltyPercent: number
}

export interface PensionStatsPoint {
    year: number
    avgPensionPercent: number
    avgPersonalSupplement: number
}

export interface GenderDistribution {
    gender: string
    count: number
    avgSalary: number
}

export interface WorkingWeeksStats {
    year: number
    avgWeeks: number
    medianWeeks: number
}

export interface ProducerContributionStats {
    year: number
    avgHolidayPayRate: number
    avgBetaRate: number
    totalHolidayPayAmount: number
    totalBetaAmount: number
    contractCount: number
}

// ── Transparency Reports ────────────────────────────────────

export interface TransparencyReport {
    id: string
    year: number
    title: string
    totalCollected: number
    totalDistributed: number
    adminCosts: number
    sources: {
        name: string // e.g. "Create Denmark", "CopyDan", "SVOD"
        collected: number
        distributed: number
    }[]
    memberCount: number
    publishedAt: string
    fileUrl?: string
}

// ── Credit Tracking ─────────────────────────────────────────

export interface CreditEntry {
    id: string
    workTitle: string
    category: Category
    premiereYear: number
    creditedRoles: string[]
    memberName: string
    memberId: string
    producerName: string
    verified: boolean
    imdbUrl?: string
    notes?: string
}

// ── Helligdagsfond (Holiday Fund) ───────────────────────────

export interface HolidayFundEntry {
    id: string
    memberId: string
    memberName: string
    year: number
    contributionRate: number // percentage of salary
    totalContribution: number
    totalPaid: number
    balance: number
    lastPaymentDate?: string
    status: "active" | "closed" | "pending"
}

export interface HolidayFundSummary {
    year: number
    totalContributions: number
    totalPaidOut: number
    balance: number
    memberCount: number
}

// ── Producer Payment Forms (Helligdagsfond & BETA) ──────────

export type FundType = "helligdag" | "beta"

export type PaymentFormStatus = "draft" | "submitted" | "verified" | "paid"

export interface ProducerPaymentForm {
    id: string
    fundType: FundType
    producerName: string
    filmTitle: string
    shootingPeriodStart: string
    shootingPeriodEnd: string
    accountClosedDate: string
    ferieberettigetLoen: number
    calculatedContribution: number // auto: løn × rate (1% or 0.5%)
    firstPayment: number // senest 6 uger efter optagelse
    previouslyPaid: number
    secondPayment: number // slutafregning
    totalSettlement: number // auto-calculated
    contactEmail: string
    status: PaymentFormStatus
    submittedAt: string
    year: number
}

// ── Barselspulje (Maternity/Parental Leave Fund) ────────────

export type LeaveType = "maternity" | "paternity" | "parental"

export interface MaternityFundEntry {
    id: string
    memberId: string
    memberName: string
    leaveType: LeaveType
    startDate: string
    endDate: string
    weeksApproved: number
    weeklyAmount: number
    totalAmount: number
    status: "applied" | "approved" | "active" | "completed" | "rejected"
    childBirthDate: string
    applicationDate: string
    notes?: string
}

export interface MaternityFundSummary {
    year: number
    totalApplicants: number
    totalApproved: number
    totalPaidOut: number
    avgWeeks: number
    byType: { type: LeaveType; count: number; totalAmount: number }[]
}

