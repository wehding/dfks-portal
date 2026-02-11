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

export interface User {
    id: string
    name: string
    email: string
    role: "member" | "admin"
    avatarUrl?: string
}

export interface Contract {
    id: string
    userId: string
    userName?: string
    title: string
    category: Category
    creditedRole: string
    duration: number // minutes (total or per episode)
    episodes?: Episode[]
    premiereDate: string
    premiereYear: number
    fileUrl: string
    status: ContractStatus
    uploadedAt: string
    extractedData?: ExtractedContractData
}

export interface ExtractedContractData {
    salary?: number
    salaryUnit?: SalaryUnit
    startDate?: string
    endDate?: string
    pensionSupplement?: number
    otherSupplements?: string
    svod: boolean
    copydan: boolean
    royalty: boolean
    royaltyPercent?: number
    distribution?: string[]
    collectiveAgreement: boolean
    collectiveAgreementName?: string
    gender?: Gender
    specialNotes?: string
}

export interface Work {
    id: string
    title: string
    creditedRole: string
    sharedCredit: boolean
    sharedWith?: string[] // names of other credited users
    duration: number
    episodes?: Episode[]
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
