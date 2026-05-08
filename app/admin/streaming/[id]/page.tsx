"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
    ArrowLeft, Plus, Lock, CheckCircle2, Clock, AlertCircle,
    ExternalLink, ChevronDown, ChevronUp, Download, Users, Pencil,
    Film, Tv, Copy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { RegisterPayoutDialog } from "@/components/streaming/register-payout-dialog"
import { AddEditorDialog } from "@/components/streaming/add-editor-dialog"
import { CreateDistributionKeyDialog } from "@/components/streaming/create-distribution-key-dialog"
import type {
    StreamingProduction, ProductionType, DistributionKeyStatus,
    DistributionShare, PayoutStatus, ExploitationType,
} from "@/lib/streaming-types"

// ── Mock interfaces ───────────────────────────────────────────

interface MockEditor {
    id: string
    name: string
    birthDate?: string
    episodes?: string
    contractUrl?: string
    userId?: string
}

interface MockDistributionKey {
    id: string
    status: DistributionKeyStatus
    proposedBy: string
    proposedAt: string
    lockedAt?: string
    documentUrl?: string
    shares: (DistributionShare & { name: string })[]
    events: { id: string; type: string; actorName: string; createdAt: string; comment?: string }[]
}

interface MockPayout {
    id: string
    payoutYear: number
    type: "irf" | "succesbetaling" | "betaling"
    grossAmount: number
    adminFeePercent: number
    adminFeeAmount: number
    netAmount: number
    status: PayoutStatus
    receivedAt: string
    distributions: { name: string; sharePercent: number; amount: number }[]
}

interface MockExploitation {
    id: string
    platform: string
    type: ExploitationType
    payer?: string
    payouts: MockPayout[]
}

interface MockProductionDetail extends StreamingProduction {
    editors: MockEditor[]
    distributionKey?: MockDistributionKey
    exploitations: MockExploitation[]
}

// ── Mock data ─────────────────────────────────────────────────

const mockData: Record<string, MockProductionDetail> = {
    "001": {
        id: "001", productionNumber: "001", title: "Kærlighed for voksne",
        type: "film_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 15,
        createdAt: "2022-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Lars Wissing", birthDate: "280282", contractUrl: "https://drive.google.com/file/d/1vhHHGS-B8oxVZA8zcecTuo8i_-Rw3-Ug/view" },
        ],
        distributionKey: {
            id: "dk1", status: "locked",
            proposedBy: "Lars Wissing", proposedAt: "2022-03-15", lockedAt: "2022-03-20",
            shares: [{ id: "s1", distributionKeyId: "dk1", editorId: "e1", name: "Lars Wissing", sharePercent: 100, acceptedAt: "2022-03-20", acceptedByUserId: "u1" }],
            events: [
                { id: "ev1", type: "proposed", actorName: "Lars Wissing", createdAt: "2022-03-15", comment: "Jeg er eneste klipper, foreslår 100%" },
                { id: "ev2", type: "accepted", actorName: "Lars Wissing", createdAt: "2022-03-20" },
                { id: "ev3", type: "locked", actorName: "Admin", createdAt: "2022-03-20" },
            ],
        },
        exploitations: [
            {
                id: "ex1", platform: "Netflix", type: "streaming",
                payouts: [
                    { id: "p1", payoutYear: 2022, type: "irf", grossAmount: 33438.59, adminFeePercent: 15, adminFeeAmount: 3343.86, netAmount: 30094.73, status: "paid", receivedAt: "2023-01-10", distributions: [{ name: "Lars Wissing", sharePercent: 100, amount: 30094.73 }] },
                    { id: "p2", payoutYear: 2023, type: "succesbetaling", grossAmount: 11154.37, adminFeePercent: 15, adminFeeAmount: 1115.44, netAmount: 10038.93, status: "paid", receivedAt: "2024-02-05", distributions: [{ name: "Lars Wissing", sharePercent: 100, amount: 10038.93 }] },
                    { id: "p3", payoutYear: 2024, type: "succesbetaling", grossAmount: 11152.22, adminFeePercent: 15, adminFeeAmount: 1672.83, netAmount: 9479.39, status: "exported", receivedAt: "2025-01-20", distributions: [{ name: "Lars Wissing", sharePercent: 100, amount: 9479.39 }] },
                ],
            },
            {
                id: "ex2", platform: "Copydan", type: "copydan",
                payouts: [
                    { id: "p4", payoutYear: 2023, type: "betaling", grossAmount: 3200.00, adminFeePercent: 8, adminFeeAmount: 243.70, netAmount: 2956.30, status: "paid", receivedAt: "2024-03-15", distributions: [{ name: "Lars Wissing", sharePercent: 100, amount: 2956.30 }] },
                ],
            },
        ],
    },
    "002": {
        id: "002", productionNumber: "002", title: "Nisser",
        type: "tv_series_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2023-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Michael Bauer", birthDate: "240183", episodes: "1, 4" },
            { id: "e2", name: "Ida Bregninge", birthDate: "260672", episodes: "2, 5" },
            { id: "e3", name: "Dan Loghin", birthDate: "150678", episodes: "3, 6" },
        ],
        distributionKey: {
            id: "dk2", status: "locked",
            proposedBy: "Michael Bauer", proposedAt: "2022-04-01", lockedAt: "2022-04-05",
            shares: [
                { id: "s1", distributionKeyId: "dk2", editorId: "e1", name: "Michael Bauer", sharePercent: 33.33, acceptedAt: "2022-04-05", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk2", editorId: "e2", name: "Ida Bregninge", sharePercent: 33.33, acceptedAt: "2022-04-04", acceptedByUserId: "u2" },
                { id: "s3", distributionKeyId: "dk2", editorId: "e3", name: "Dan Loghin", sharePercent: 33.34, acceptedAt: "2022-04-03", acceptedByUserId: "u3" },
            ],
            events: [
                { id: "ev1", type: "proposed", actorName: "Michael Bauer", createdAt: "2022-04-01", comment: "Ligelig fordeling — 3 klippere" },
                { id: "ev2", type: "accepted", actorName: "Dan Loghin", createdAt: "2022-04-03" },
                { id: "ev3", type: "accepted", actorName: "Ida Bregninge", createdAt: "2022-04-04" },
                { id: "ev4", type: "accepted", actorName: "Michael Bauer", createdAt: "2022-04-05" },
                { id: "ev5", type: "locked", actorName: "Admin", createdAt: "2022-04-05" },
            ],
        },
        exploitations: [{
            id: "ex1", platform: "Netflix", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2022, type: "irf", grossAmount: 27864.74, adminFeePercent: 10, adminFeeAmount: 2786.47, netAmount: 25078.27, status: "paid", receivedAt: "2023-01-10", distributions: [{ name: "Michael Bauer", sharePercent: 33.33, amount: 8359.42 }, { name: "Ida Bregninge", sharePercent: 33.33, amount: 8359.42 }, { name: "Dan Loghin", sharePercent: 33.34, amount: 8359.43 }] },
            ],
        }],
    },
    "003": {
        id: "003", productionNumber: "003", title: "Toscana",
        type: "film_licensed", premiereYear: 2022,
        licenseDurationYears: 10, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Anders Hoffmann", birthDate: "060772" },
            { id: "e2", name: "Niels Ostenfeld", birthDate: "151178" },
        ],
        distributionKey: {
            id: "dk3", status: "locked",
            proposedBy: "Anders Hoffmann", proposedAt: "2022-05-01", lockedAt: "2022-05-05",
            shares: [
                { id: "s1", distributionKeyId: "dk3", editorId: "e1", name: "Anders Hoffmann", sharePercent: 60, acceptedAt: "2022-05-05", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk3", editorId: "e2", name: "Niels Ostenfeld", sharePercent: 40, acceptedAt: "2022-05-03", acceptedByUserId: "u2" },
            ],
            events: [
                { id: "ev1", type: "proposed", actorName: "Anders Hoffmann", createdAt: "2022-05-01", comment: "60/40 baseret på arbejdsindsats" },
                { id: "ev2", type: "accepted", actorName: "Niels Ostenfeld", createdAt: "2022-05-03" },
                { id: "ev3", type: "accepted", actorName: "Anders Hoffmann", createdAt: "2022-05-05" },
                { id: "ev4", type: "locked", actorName: "Admin", createdAt: "2022-05-05" },
            ],
        },
        exploitations: [{
            id: "ex1", platform: "Netflix", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2022, type: "irf", grossAmount: 22292.39, adminFeePercent: 10, adminFeeAmount: 2229.24, netAmount: 20063.15, status: "paid", receivedAt: "2023-01-10", distributions: [{ name: "Anders Hoffmann", sharePercent: 60, amount: 12037.89 }, { name: "Niels Ostenfeld", sharePercent: 40, amount: 8025.26 }] },
                { id: "p2", payoutYear: 2023, type: "succesbetaling", grossAmount: 11154.37, adminFeePercent: 10, adminFeeAmount: 1115.44, netAmount: 10038.93, status: "paid", receivedAt: "2024-02-05", distributions: [{ name: "Anders Hoffmann", sharePercent: 60, amount: 6023.36 }, { name: "Niels Ostenfeld", sharePercent: 40, amount: 4015.57 }] },
            ],
        }],
    },
    "004": {
        id: "004", productionNumber: "004", title: "Kastanjemanden",
        type: "tv_series_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2023-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Cathrine Ambus", birthDate: "281271", episodes: "3, 6" },
            { id: "e2", name: "Anja Farsig", birthDate: "091171", episodes: "2, 5" },
            { id: "e3", name: "Martin Schade", episodes: "1, 4" },
            { id: "e4", name: "Lars Therkelsen", birthDate: "220767", episodes: "4" },
        ],
        distributionKey: {
            id: "dk4", status: "locked",
            proposedBy: "Cathrine Ambus", proposedAt: "2022-06-01", lockedAt: "2022-06-10",
            shares: [
                { id: "s1", distributionKeyId: "dk4", editorId: "e1", name: "Cathrine Ambus", sharePercent: 33.33, acceptedAt: "2022-06-10", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk4", editorId: "e2", name: "Anja Farsig", sharePercent: 33.33, acceptedAt: "2022-06-08", acceptedByUserId: "u2" },
                { id: "s3", distributionKeyId: "dk4", editorId: "e3", name: "Martin Schade", sharePercent: 25.01, acceptedAt: "2022-06-07", acceptedByUserId: "u3" },
                { id: "s4", distributionKeyId: "dk4", editorId: "e4", name: "Lars Therkelsen", sharePercent: 8.33, acceptedAt: "2022-06-06", acceptedByUserId: "u4" },
            ],
            events: [
                { id: "ev1", type: "proposed", actorName: "Cathrine Ambus", createdAt: "2022-06-01" },
                { id: "ev2", type: "locked", actorName: "Admin", createdAt: "2022-06-10" },
            ],
        },
        exploitations: [{
            id: "ex1", platform: "Netflix", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2022, type: "irf", grossAmount: 55730.97, adminFeePercent: 10, adminFeeAmount: 5573.10, netAmount: 50157.87, status: "paid", receivedAt: "2023-01-10", distributions: [{ name: "Cathrine Ambus", sharePercent: 33.33, amount: 16719.29 }, { name: "Anja Farsig", sharePercent: 33.33, amount: 16719.29 }, { name: "Martin Schade", sharePercent: 25.01, amount: 12539.47 }, { name: "Lars Therkelsen", sharePercent: 8.33, amount: 4179.82 }] },
            ],
        }],
    },
    "005": {
        id: "005", productionNumber: "005", title: "Skruk Sæson 1",
        type: "tv_series_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2022-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Jonas Kirkegaard", episodes: "1, 2" },
            { id: "e2", name: "Sofie Dalgaard", episodes: "3, 4" },
            { id: "e3", name: "Marcus Brandt", episodes: "5, 6" },
        ],
        distributionKey: undefined,
        exploitations: [],
    },
    "006": {
        id: "006", productionNumber: "006", title: "Ehrengard",
        type: "tv_series_original", premiereYear: 2023,
        licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 10,
        createdAt: "2023-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Janus Billeskov Jansen", birthDate: "251151" },
            { id: "e2", name: "Biel Andrés", birthDate: "160488" },
        ],
        distributionKey: {
            id: "dk6", status: "locked",
            proposedBy: "Janus Billeskov Jansen", proposedAt: "2023-02-01", lockedAt: "2023-02-10",
            shares: [
                { id: "s1", distributionKeyId: "dk6", editorId: "e1", name: "Janus Billeskov Jansen", sharePercent: 60, acceptedAt: "2023-02-10", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk6", editorId: "e2", name: "Biel Andrés", sharePercent: 40, acceptedAt: "2023-02-08", acceptedByUserId: "u2" },
            ],
            events: [
                { id: "ev1", type: "proposed", actorName: "Janus Billeskov Jansen", createdAt: "2023-02-01", comment: "60/40 fordeling" },
                { id: "ev2", type: "locked", actorName: "Admin", createdAt: "2023-02-10" },
            ],
        },
        exploitations: [{
            id: "ex1", platform: "Netflix", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2023, type: "irf", grossAmount: 36815.61, adminFeePercent: 10, adminFeeAmount: 3681.56, netAmount: 33134.05, status: "paid", receivedAt: "2024-01-10", distributions: [{ name: "Janus Billeskov Jansen", sharePercent: 60, amount: 19880.43 }, { name: "Biel Andrés", sharePercent: 40, amount: 13253.62 }] },
                { id: "p2", payoutYear: 2024, type: "succesbetaling", grossAmount: 11154.37, adminFeePercent: 10, adminFeeAmount: 1115.44, netAmount: 10038.93, status: "paid", receivedAt: "2025-01-10", distributions: [{ name: "Janus Billeskov Jansen", sharePercent: 60, amount: 6023.36 }, { name: "Biel Andrés", sharePercent: 40, amount: 4015.57 }] },
            ],
        }],
    },
    "007": {
        id: "007", productionNumber: "007", title: "A Beautiful Life",
        type: "tv_series_original", premiereYear: 2023,
        licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 15,
        createdAt: "2023-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [{ id: "e1", name: "Anders Hofman", birthDate: "060772" }],
        distributionKey: {
            id: "dk7", status: "locked",
            proposedBy: "Anders Hofman", proposedAt: "2023-03-01", lockedAt: "2023-03-05",
            shares: [{ id: "s1", distributionKeyId: "dk7", editorId: "e1", name: "Anders Hofman", sharePercent: 100, acceptedAt: "2023-03-05", acceptedByUserId: "u1" }],
            events: [{ id: "ev1", type: "locked", actorName: "Admin", createdAt: "2023-03-05" }],
        },
        exploitations: [{
            id: "ex1", platform: "Netflix", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2023, type: "irf", grossAmount: 22799.51, adminFeePercent: 15, adminFeeAmount: 2279.95, netAmount: 20519.56, status: "paid", receivedAt: "2024-01-10", distributions: [{ name: "Anders Hofman", sharePercent: 100, amount: 20519.56 }] },
                { id: "p2", payoutYear: 2024, type: "succesbetaling", grossAmount: 22308.73, adminFeePercent: 15, adminFeeAmount: 2230.87, netAmount: 20077.86, status: "paid", receivedAt: "2025-01-10", distributions: [{ name: "Anders Hofman", sharePercent: 100, amount: 20077.86 }] },
                { id: "p3", payoutYear: 2025, type: "succesbetaling", grossAmount: 11152.22, adminFeePercent: 15, adminFeeAmount: 1672.83, netAmount: 9479.39, status: "pending", receivedAt: "2025-03-10", distributions: [{ name: "Anders Hofman", sharePercent: 100, amount: 9479.39 }] },
            ],
        }],
    },
    "008": {
        id: "008", productionNumber: "008", title: "Sygeplejersken",
        type: "tv_series_original", premiereYear: 2023,
        licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 15,
        createdAt: "2023-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Elin Pröjts", episodes: "1, 3" },
            { id: "e2", name: "Anna Heide", episodes: "2, 4, 5" },
            { id: "e3", name: "Benjamin Binderup", episodes: "6, 7" },
            { id: "e4", name: "Tómas Gislason", episodes: "8" },
        ],
        distributionKey: {
            id: "dk8", status: "proposed",
            proposedBy: "Anna Heide", proposedAt: "2025-03-10",
            shares: [
                { id: "s1", distributionKeyId: "dk8", editorId: "e1", name: "Elin Pröjts", sharePercent: 25, acceptedAt: "2025-03-11", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk8", editorId: "e2", name: "Anna Heide", sharePercent: 37.5, acceptedAt: "2025-03-10", acceptedByUserId: "u2" },
                { id: "s3", distributionKeyId: "dk8", editorId: "e3", name: "Benjamin Binderup", sharePercent: 25 },
                { id: "s4", distributionKeyId: "dk8", editorId: "e4", name: "Tómas Gislason", sharePercent: 12.5 },
            ],
            events: [
                { id: "ev1", type: "proposed", actorName: "Anna Heide", createdAt: "2025-03-10", comment: "Fordelingsnøgle foreslået baseret på episodeantal" },
                { id: "ev2", type: "accepted", actorName: "Elin Pröjts", createdAt: "2025-03-11" },
                { id: "ev3", type: "accepted", actorName: "Anna Heide", createdAt: "2025-03-10" },
            ],
        },
        exploitations: [{
            id: "ex1", platform: "DR", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2023, type: "succesbetaling", grossAmount: 15411.50, adminFeePercent: 15, adminFeeAmount: 1541.15, netAmount: 13870.35, status: "paid", receivedAt: "2024-02-05", distributions: [{ name: "Elin Pröjts", sharePercent: 25, amount: 3467.59 }, { name: "Anna Heide", sharePercent: 37.5, amount: 5201.38 }, { name: "Benjamin Binderup", sharePercent: 25, amount: 3467.59 }, { name: "Tómas Gislason", sharePercent: 12.5, amount: 1733.79 }] },
                { id: "p2", payoutYear: 2024, type: "succesbetaling", grossAmount: 27880.54, adminFeePercent: 15, adminFeeAmount: 4182.08, netAmount: 23698.46, status: "pending", receivedAt: "2025-02-10", distributions: [{ name: "Elin Pröjts", sharePercent: 25, amount: 5924.61 }, { name: "Anna Heide", sharePercent: 37.5, amount: 8886.92 }, { name: "Benjamin Binderup", sharePercent: 25, amount: 5924.61 }, { name: "Tómas Gislason", sharePercent: 12.5, amount: 2962.31 }] },
            ],
        }],
    },
    "009": {
        id: "009", productionNumber: "009", title: "Skruk Sæson 2",
        type: "tv_series_original", premiereYear: 2024,
        licenseDurationYears: 50, licenseStartYear: 2024, adminFeePercent: 10,
        createdAt: "2024-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Lars Terkelsen", episodes: "" },
            { id: "e2", name: "Jakob Juul Toldam", episodes: "" },
            { id: "e3", name: "Kasper Schultz Simonsen", episodes: "" },
        ],
        distributionKey: {
            id: "dk9", status: "locked",
            proposedBy: "Lars Terkelsen", proposedAt: "2024-02-01", lockedAt: "2024-02-10",
            shares: [
                { id: "s1", distributionKeyId: "dk9", editorId: "e1", name: "Lars Terkelsen", sharePercent: 22.23, acceptedAt: "2024-02-10", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk9", editorId: "e2", name: "Jakob Juul Toldam", sharePercent: 33.34, acceptedAt: "2024-02-08", acceptedByUserId: "u2" },
                { id: "s3", distributionKeyId: "dk9", editorId: "e3", name: "Kasper Schultz Simonsen", sharePercent: 44.43, acceptedAt: "2024-02-07", acceptedByUserId: "u3" },
            ],
            events: [{ id: "ev1", type: "locked", actorName: "Admin", createdAt: "2024-02-10" }],
        },
        exploitations: [{
            id: "ex1", platform: "DR", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2024, type: "irf", grossAmount: 28807.67, adminFeePercent: 10, adminFeeAmount: 2880.77, netAmount: 25926.90, status: "paid", receivedAt: "2025-01-10", distributions: [{ name: "Lars Terkelsen", sharePercent: 22.23, amount: 5764.41 }, { name: "Jakob Juul Toldam", sharePercent: 33.34, amount: 8642.30 }, { name: "Kasper Schultz Simonsen", sharePercent: 44.43, amount: 11520.19 }] },
            ],
        }],
    },
    "010": {
        id: "010", productionNumber: "010", title: "Bytte Bytte Baby 2",
        type: "film_original", premiereYear: 2024,
        licenseDurationYears: 50, licenseStartYear: 2024, adminFeePercent: 10,
        createdAt: "2024-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Benjamin Binderup" },
            { id: "e2", name: "Carsten Søsted" },
        ],
        distributionKey: {
            id: "dk10", status: "locked",
            proposedBy: "Benjamin Binderup", proposedAt: "2024-03-01", lockedAt: "2024-03-05",
            shares: [
                { id: "s1", distributionKeyId: "dk10", editorId: "e1", name: "Benjamin Binderup", sharePercent: 50, acceptedAt: "2024-03-05", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk10", editorId: "e2", name: "Carsten Søsted", sharePercent: 50, acceptedAt: "2024-03-03", acceptedByUserId: "u2" },
            ],
            events: [{ id: "ev1", type: "locked", actorName: "Admin", createdAt: "2024-03-05" }],
        },
        exploitations: [{
            id: "ex1", platform: "Netflix", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2024, type: "irf", grossAmount: 18000, adminFeePercent: 10, adminFeeAmount: 1800, netAmount: 16200, status: "paid", receivedAt: "2025-03-10", distributions: [{ name: "Benjamin Binderup", sharePercent: 50, amount: 8100 }, { name: "Carsten Søsted", sharePercent: 50, amount: 8100 }] },
            ],
        }],
    },
    "011": {
        id: "011", productionNumber: "011", title: "Sult",
        type: "film_original", premiereYear: 2025,
        licenseDurationYears: 50, licenseStartYear: 2025, adminFeePercent: 15,
        createdAt: "2025-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Peter Winther" },
            { id: "e2", name: "Viola Frederikke Lindkvist Hjorth" },
        ],
        distributionKey: {
            id: "dk11", status: "accepted",
            proposedBy: "Peter Winther", proposedAt: "2025-02-01",
            shares: [
                { id: "s1", distributionKeyId: "dk11", editorId: "e1", name: "Peter Winther", sharePercent: 50, acceptedAt: "2025-02-05", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk11", editorId: "e2", name: "Viola Frederikke Lindkvist Hjorth", sharePercent: 50, acceptedAt: "2025-02-04", acceptedByUserId: "u2" },
            ],
            events: [
                { id: "ev1", type: "proposed", actorName: "Peter Winther", createdAt: "2025-02-01", comment: "50/50 fordeling" },
                { id: "ev2", type: "accepted", actorName: "Viola Frederikke Lindkvist Hjorth", createdAt: "2025-02-04" },
                { id: "ev3", type: "accepted", actorName: "Peter Winther", createdAt: "2025-02-05" },
            ],
        },
        exploitations: [{
            id: "ex1", platform: "Netflix", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2025, type: "irf", grossAmount: 28946.25, adminFeePercent: 15, adminFeeAmount: 4341.94, netAmount: 24604.31, status: "pending", receivedAt: "2025-04-10", distributions: [{ name: "Peter Winther", sharePercent: 50, amount: 12302.16 }, { name: "Viola Frederikke Lindkvist Hjorth", sharePercent: 50, amount: 12302.16 }] },
            ],
        }],
    },
    "012": {
        id: "012", productionNumber: "012", title: "Reservatet",
        type: "tv_series_original", premiereYear: 2025,
        licenseDurationYears: 50, licenseStartYear: 2025, adminFeePercent: 15,
        createdAt: "2025-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [
            { id: "e1", name: "Anja Farsig", episodes: "1, 2" },
            { id: "e2", name: "Kasper Leick", episodes: "3, 4, 5" },
            { id: "e3", name: "Frederik Strunk", episodes: "6, 7, 8" },
        ],
        distributionKey: {
            id: "dk12", status: "locked",
            proposedBy: "Anja Farsig", proposedAt: "2025-03-01", lockedAt: "2025-03-10",
            shares: [
                { id: "s1", distributionKeyId: "dk12", editorId: "e1", name: "Anja Farsig", sharePercent: 22, acceptedAt: "2025-03-10", acceptedByUserId: "u1" },
                { id: "s2", distributionKeyId: "dk12", editorId: "e2", name: "Kasper Leick", sharePercent: 39, acceptedAt: "2025-03-08", acceptedByUserId: "u2" },
                { id: "s3", distributionKeyId: "dk12", editorId: "e3", name: "Frederik Strunk", sharePercent: 39, acceptedAt: "2025-03-07", acceptedByUserId: "u3" },
            ],
            events: [{ id: "ev1", type: "locked", actorName: "Admin", createdAt: "2025-03-10" }],
        },
        exploitations: [{
            id: "ex1", platform: "DR", type: "streaming",
            payouts: [
                { id: "p1", payoutYear: 2025, type: "irf", grossAmount: 70541.15, adminFeePercent: 15, adminFeeAmount: 10581.17, netAmount: 59959.98, status: "paid", receivedAt: "2025-04-01", distributions: [{ name: "Anja Farsig", sharePercent: 22, amount: 13191.20 }, { name: "Kasper Leick", sharePercent: 39, amount: 23384.39 }, { name: "Frederik Strunk", sharePercent: 39, amount: 23384.39 }] },
            ],
        }],
    },
}

// ── Helpers ──────────────────────────────────────────────────

function fmt(n: number) {
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(n)
}

function fmt2(n: number) {
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function typeLabel(type: ProductionType): string {
    const map: Record<ProductionType, string> = {
        film_original: "Film · Original", film_licensed: "Film · Licenseret",
        tv_series_original: "TV Serie · Original", tv_series_licensed: "TV Serie · Licenseret",
        short_original: "Kortfilm · Original", documentary_original: "Dokumentar · Original",
    }
    return map[type] ?? type
}

const EXPLOITATION_TYPE_LABELS: Record<ExploitationType, string> = {
    streaming:  "Streaming",
    broadcast:  "Broadcast",
    royalties:  "Royalties",
    copydan:    "Copydan",
}

const PAYOUT_TYPE_LABELS: Record<"irf" | "succesbetaling" | "betaling", string> = {
    irf:           "IRF",
    succesbetaling: "Succesbetaling",
    betaling:      "Betaling",
}

function KeyStatusBadge({ status }: { status?: DistributionKeyStatus }) {
    if (!status || status === "draft") return <Badge variant="outline" className="gap-1 text-muted-foreground"><AlertCircle className="h-3 w-3" />Ingen nøgle</Badge>
    if (status === "proposed") return <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950"><Clock className="h-3 w-3" />Afventer accept</Badge>
    if (status === "accepted") return <Badge variant="outline" className="gap-1 text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950"><CheckCircle2 className="h-3 w-3" />Accepteret</Badge>
    if (status === "locked") return <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50 dark:bg-green-950"><Lock className="h-3 w-3" />Låst</Badge>
    return null
}

function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
    if (status === "pending") return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950">Afventer</Badge>
    if (status === "distributing") return <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950">Fordeles</Badge>
    if (status === "exported") return <Badge variant="outline" className="text-purple-600 border-purple-300 bg-purple-50 dark:bg-purple-950">Eksporteret</Badge>
    if (status === "paid") return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950">Udbetalt</Badge>
    return null
}

function generatePayoutText(production: MockProductionDetail, exploitation: MockExploitation, payout: MockPayout): string {
    const typeStr = PAYOUT_TYPE_LABELS[payout.type]
    const lines = [
        `${typeStr} — ${production.title} (${payout.payoutYear})`,
        `Platform: ${exploitation.platform}`,
        `Modtaget: ${fmt2(payout.grossAmount)}`,
        `Administrationsgebyr (${payout.adminFeePercent}%): ${fmt2(payout.adminFeeAmount)}`,
        `Til fordeling: ${fmt2(payout.netAmount)}`,
        ``,
        `Fordeling:`,
        ...payout.distributions.map(d => `  ${d.name} — ${d.sharePercent}% — ${fmt2(d.amount)}`),
    ]
    return lines.join("\n")
}

// ── Page ─────────────────────────────────────────────────────

export default function StreamingDetailPage() {
    const params = useParams()
    const id = params.id as string
    const [expandedPayout, setExpandedPayout] = useState<string | null>(null)
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [showRegister, setShowRegister] = useState(false)
    const [activeExploitationId, setActiveExploitationId] = useState<string | undefined>(undefined)
    const [showAddEditor, setShowAddEditor] = useState(false)
    const [showCreateKey, setShowCreateKey] = useState(false)

    const production = mockData[id]

    if (!production) {
        return (
            <div className="space-y-4">
                <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" asChild>
                    <Link href="/admin/streaming">
                        <ArrowLeft className="h-4 w-4" />
                        Tilbage til oversigt
                    </Link>
                </Button>
                <div className="py-12 text-center text-sm text-muted-foreground">
                    Værk ikke fundet
                </div>
            </div>
        )
    }

    const allPayouts = production.exploitations.flatMap(e => e.payouts)
    const totalReceived = allPayouts.reduce((s, p) => s + p.grossAmount, 0)
    const totalNet = allPayouts.reduce((s, p) => s + p.netAmount, 0)
    const totalAdmin = allPayouts.reduce((s, p) => s + p.adminFeeAmount, 0)
    const pendingPayouts = allPayouts.filter(p => p.status === "pending" || p.status === "distributing")
    const canExport = production.distributionKey?.status === "locked" && pendingPayouts.length > 0

    const acceptedCount = production.distributionKey?.shares.filter(s => s.acceptedAt).length ?? 0
    const totalShares = production.distributionKey?.shares.length ?? 0

    const exploitationOptions = production.exploitations.map(e => ({
        id: e.id, platform: e.platform, type: e.type, payer: e.payer,
    }))

    function copyPayoutText(exploitation: MockExploitation, payout: MockPayout) {
        const text = generatePayoutText(production, exploitation, payout)
        navigator.clipboard.writeText(text)
        setCopiedId(payout.id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const licenseYearsRemaining = production.licenseStartYear + production.licenseDurationYears - new Date().getFullYear()

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Back */}
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" asChild>
                <Link href="/admin/streaming">
                    <ArrowLeft className="h-4 w-4" />
                    Tilbage til oversigt
                </Link>
            </Button>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                        <span className="font-mono">{production.productionNumber}</span>
                        <span>·</span>
                        {production.type.startsWith("film") ? <Film className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
                        <span>{typeLabel(production.type)}</span>
                        {production.season && <><span>·</span><span>Sæson {production.season}</span></>}
                        <span>·</span>
                        <span>{production.premiereYear}</span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight">{production.title}</h1>
                    <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                        <span>Licens: {production.licenseDurationYears} år fra {production.licenseStartYear}</span>
                        <span>·</span>
                        <span className={licenseYearsRemaining < 5 ? "text-amber-600" : ""}>{licenseYearsRemaining} år tilbage</span>
                    </div>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <Pencil className="h-3.5 w-3.5" />
                    Rediger
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Modtaget i alt</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totalReceived)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Udbetalt til klippere</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totalNet)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Adm. gebyr i alt</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totalAdmin)}</p>
                </div>
            </div>

            {/* Klippere */}
            <div className="rounded-lg border">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <h2 className="font-medium flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Klippere
                    </h2>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAddEditor(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        Tilføj klipper
                    </Button>
                </div>
                <div className="divide-y">
                    {production.editors.map(editor => (
                        <div key={editor.id} className="flex items-center gap-4 px-4 py-3">
                            <div className="flex-1">
                                <p className="text-sm font-medium">{editor.name}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {editor.birthDate && <span>f. {editor.birthDate}</span>}
                                    {editor.birthDate && editor.episodes && <span> · </span>}
                                    {editor.episodes && <span>Episoder: {editor.episodes}</span>}
                                </p>
                            </div>
                            {editor.contractUrl && (
                                <a href={editor.contractUrl} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    <ExternalLink className="h-3 w-3" />
                                    Kontrakt
                                </a>
                            )}
                        </div>
                    ))}
                    {production.editors.length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                            Ingen klippere tilknyttet endnu
                        </div>
                    )}
                </div>
            </div>

            {/* Fordelingsnøgle */}
            <div className="rounded-lg border">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <h2 className="font-medium">Fordelingsnøgle</h2>
                    <div className="flex items-center gap-2">
                        <KeyStatusBadge status={production.distributionKey?.status} />
                        {(!production.distributionKey || production.distributionKey.status === "draft") && (
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCreateKey(true)}>
                                <Plus className="h-3.5 w-3.5" />
                                Opret nøgle
                            </Button>
                        )}
                        {production.distributionKey?.status === "accepted" && (
                            <Button size="sm" className="gap-1.5">
                                <Lock className="h-3.5 w-3.5" />
                                Lås nøgle
                            </Button>
                        )}
                    </div>
                </div>

                {production.distributionKey ? (
                    <div>
                        <div className="divide-y">
                            {production.distributionKey.shares.map(share => (
                                <div key={share.id} className="flex items-center gap-4 px-4 py-3">
                                    <div className="flex-1">
                                        <p className="text-sm font-medium">{share.name}</p>
                                    </div>
                                    <div className="text-sm tabular-nums font-medium w-16 text-right">
                                        {share.sharePercent}%
                                    </div>
                                    <div className="w-28 flex justify-end">
                                        {share.acceptedAt ? (
                                            <span className="flex items-center gap-1 text-xs text-green-600">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Accepteret
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs text-amber-600">
                                                <Clock className="h-3 w-3" />
                                                Afventer
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {production.distributionKey.status !== "locked" && (
                            <div className="px-4 py-3 border-t bg-muted/30 text-sm text-muted-foreground">
                                {acceptedCount} af {totalShares} klippere har accepteret
                            </div>
                        )}

                        {production.distributionKey.events.length > 0 && (
                            <div className="px-4 py-3 border-t">
                                <p className="text-xs font-medium text-muted-foreground mb-2">Historik</p>
                                <div className="space-y-1.5">
                                    {production.distributionKey.events.map(ev => (
                                        <div key={ev.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                                            <span className="shrink-0 tabular-nums">{ev.createdAt}</span>
                                            <span className="font-medium text-foreground">{ev.actorName}</span>
                                            <span>
                                                {ev.type === "proposed" && "foreslog nøgle"}
                                                {ev.type === "accepted" && "accepterede"}
                                                {ev.type === "rejected" && "afviste"}
                                                {ev.type === "locked" && "låste nøglen"}
                                            </span>
                                            {ev.comment && <span className="italic">"{ev.comment}"</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Ingen fordelingsnøgle oprettet endnu
                    </div>
                )}
            </div>

            {/* Udbetalinger — grupperet per udnyttelse */}
            <div className="rounded-lg border">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <h2 className="font-medium">Udbetalinger</h2>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setActiveExploitationId(undefined); setShowRegister(true) }}>
                        <Plus className="h-3.5 w-3.5" />
                        Registrér betaling
                    </Button>
                </div>

                {production.exploitations.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Ingen udnyttelser registreret endnu
                    </div>
                ) : (
                    <div className="divide-y">
                        {production.exploitations.map(exploitation => (
                            <div key={exploitation.id} className="p-4 space-y-3">
                                {/* Exploitation header */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{exploitation.platform}</span>
                                        <Badge variant="outline" className="text-xs">
                                            {EXPLOITATION_TYPE_LABELS[exploitation.type]}
                                        </Badge>
                                        {exploitation.payer && (
                                            <span className="text-xs text-muted-foreground">via {exploitation.payer}</span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                                        onClick={() => { setActiveExploitationId(exploitation.id); setShowRegister(true) }}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Registrér betaling
                                    </Button>
                                </div>

                                {/* Payouts */}
                                {exploitation.payouts.length === 0 ? (
                                    <p className="text-xs text-muted-foreground pl-1">Ingen betalinger registreret endnu</p>
                                ) : (
                                    <div className="rounded-md border divide-y">
                                        {exploitation.payouts.map(payout => (
                                            <div key={payout.id}>
                                                <button
                                                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                                                    onClick={() => setExpandedPayout(expandedPayout === payout.id ? null : payout.id)}
                                                >
                                                    <div className="flex-1">
                                                        <p className="text-sm font-medium">
                                                            {payout.payoutYear} — {PAYOUT_TYPE_LABELS[payout.type]}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            Modtaget {payout.receivedAt}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm font-medium tabular-nums">{fmt2(payout.grossAmount)}</p>
                                                    </div>
                                                    <PayoutStatusBadge status={payout.status} />
                                                    {expandedPayout === payout.id
                                                        ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                                                        : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                                    }
                                                </button>

                                                {expandedPayout === payout.id && (
                                                    <div className="px-4 pb-4 pt-1 border-t bg-muted/20 space-y-3">
                                                        <div className="rounded-md border bg-card p-3 text-sm space-y-1.5">
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Modtaget</span>
                                                                <span className="tabular-nums font-medium">{fmt2(payout.grossAmount)}</span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Adm. gebyr ({payout.adminFeePercent}%)</span>
                                                                <span className="tabular-nums text-muted-foreground">− {fmt2(payout.adminFeeAmount)}</span>
                                                            </div>
                                                            <Separator />
                                                            <div className="flex justify-between font-medium">
                                                                <span>Til fordeling</span>
                                                                <span className="tabular-nums">{fmt2(payout.netAmount)}</span>
                                                            </div>
                                                        </div>

                                                        <div className="rounded-md border bg-card divide-y text-sm">
                                                            {payout.distributions.map((d, i) => (
                                                                <div key={i} className="flex items-center gap-3 px-3 py-2">
                                                                    <span className="flex-1">{d.name}</span>
                                                                    <span className="text-muted-foreground tabular-nums w-10 text-right">{d.sharePercent}%</span>
                                                                    <span className="tabular-nums font-medium w-24 text-right">{fmt2(d.amount)}</span>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div className="flex gap-2">
                                                            <Button
                                                                variant="outline" size="sm" className="gap-1.5"
                                                                onClick={() => copyPayoutText(exploitation, payout)}
                                                            >
                                                                <Copy className="h-3.5 w-3.5" />
                                                                {copiedId === payout.id ? "Kopieret!" : "Kopiér til lønsystem"}
                                                            </Button>
                                                            {payout.status === "pending" && production.distributionKey?.status === "locked" && (
                                                                <Button size="sm" className="gap-1.5">
                                                                    <Download className="h-3.5 w-3.5" />
                                                                    Markér som eksporteret
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Dialogs */}
            <RegisterPayoutDialog
                open={showRegister}
                onClose={() => { setShowRegister(false); setActiveExploitationId(undefined) }}
                productionTitle={production.title}
                existingExploitations={exploitationOptions}
                preselectedExploitationId={activeExploitationId}
                onRegister={(data) => {
                    console.log("Registreret:", data)
                    setShowRegister(false)
                    setActiveExploitationId(undefined)
                }}
            />

            <AddEditorDialog
                open={showAddEditor}
                onClose={() => setShowAddEditor(false)}
                productionTitle={production.title}
                isSeries={production.type.startsWith("tv_series")}
                onAdd={(editor) => {
                    console.log("Tilføjet:", editor)
                    setShowAddEditor(false)
                }}
            />

            <CreateDistributionKeyDialog
                open={showCreateKey}
                onClose={() => setShowCreateKey(false)}
                productionTitle={production.title}
                editors={production.editors.map(e => ({ id: e.id, name: e.name }))}
                onCreate={(shares) => {
                    console.log("Nøgle oprettet:", shares)
                    setShowCreateKey(false)
                }}
            />
        </div>
    )
}
