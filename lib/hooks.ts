"use client"

/**
 * Data hooks for the legacy streaming/stamdata prototype surface.
 * These are intentionally local-state backed until the remaining prototype
 * screens are migrated to Supabase-backed actions.
 * The component API stays the same.
 */

import { useState, useCallback, useEffect } from "react"
import type { Contract, MasterDataItem, Work } from "./types"
import {
    mockWorks as initialWorks,
    mockRoles as initialRoles,
    mockCategories as initialCategories,
    mockPlatforms as initialPlatforms,
    mockProductionTypes as initialProductionTypes,
    mockLicensePeriods as initialLicensePeriods,
} from "./mock-data"
import { contractStore } from "./contract-store"

// ── Contracts ───────────────────────────────────────────────

export function useContracts() {
    const [contracts, setContracts] = useState<Contract[]>(contractStore.getAll)

    useEffect(() => contractStore.subscribe(() => setContracts(contractStore.getAll())), [])

    const deleteContract = useCallback((id: string) => {
        contractStore.remove(id)
    }, [])

    const updateContract = useCallback((id: string, updates: Partial<Contract>) => {
        contractStore.update(id, updates)
    }, [])

    const addContract = useCallback((contract: Contract) => {
        contractStore.add(contract)
    }, [])

    return { contracts, deleteContract, updateContract, addContract }
}

// ── Works ───────────────────────────────────────────────────

export function useWorks(initialData?: Work[]) {
    const [works, setWorks] = useState<Work[]>(initialData ?? initialWorks)

    const deleteWork = useCallback((id: string) => {
        setWorks((prev) => prev.filter((w) => w.id !== id))
    }, [])

    return { works, deleteWork }
}

// ── Master Data ─────────────────────────────────────────────

export function useMasterData(type: "roles" | "categories" | "platforms" | "productionTypes" | "licensePeriods") {
    const initial =
        type === "roles" ? initialRoles :
        type === "platforms" ? initialPlatforms :
        type === "productionTypes" ? initialProductionTypes :
        type === "licensePeriods" ? initialLicensePeriods :
        initialCategories
    const [items, setItems] = useState<MasterDataItem[]>(initial)

    const addItem = useCallback((name: string) => {
        const newItem: MasterDataItem = {
            id: `${type}_${Date.now()}`,
            name,
            active: true,
        }
        setItems((prev) => [...prev, newItem])
    }, [type])

    const deleteItem = useCallback((id: string) => {
        setItems((prev) => prev.filter((item) => item.id !== id))
    }, [])

    const toggleActive = useCallback((id: string) => {
        setItems((prev) =>
            prev.map((item) =>
                item.id === id ? { ...item, active: !item.active } : item
            )
        )
    }, [])

    const renameItem = useCallback((id: string, name: string) => {
        setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, name } : item))
        )
    }, [])

    const reorderItems = useCallback((fromIndex: number, toIndex: number) => {
        setItems((prev) => {
            const next = [...prev]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return next
        })
    }, [])

    return { items, addItem, deleteItem, toggleActive, renameItem, reorderItems }
}
