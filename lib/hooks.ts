"use client"

/**
 * Data hooks — currently backed by local state + mock data.
 * When Supabase is ready, swap internals to useQuery/useMutation.
 * The component API stays the same.
 */

import { useState, useCallback } from "react"
import type { Contract, MasterDataItem, Work } from "./types"
import {
    mockContracts as initialContracts,
    mockWorks as initialWorks,
    mockRoles as initialRoles,
    mockCategories as initialCategories,
    mockPlatforms as initialPlatforms,
} from "./mock-data"

// ── Contracts ───────────────────────────────────────────────

export function useContracts(initialData?: Contract[]) {
    const [contracts, setContracts] = useState<Contract[]>(
        initialData ?? initialContracts
    )

    const deleteContract = useCallback((id: string) => {
        // TODO: await supabase.from('contracts').delete().eq('id', id)
        setContracts((prev) => prev.filter((c) => c.id !== id))
    }, [])

    const updateContract = useCallback((id: string, updates: Partial<Contract>) => {
        // TODO: await supabase.from('contracts').update(updates).eq('id', id)
        setContracts((prev) =>
            prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
        )
    }, [])

    const addContract = useCallback((contract: Contract) => {
        // TODO: await supabase.from('contracts').insert(contract)
        setContracts((prev) => [contract, ...prev])
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

export function useMasterData(type: "roles" | "categories" | "platforms") {
    const initial = type === "roles" ? initialRoles : type === "platforms" ? initialPlatforms : initialCategories
    const [items, setItems] = useState<MasterDataItem[]>(initial)

    const addItem = useCallback((name: string) => {
        // TODO: await supabase.from(type).insert({ name, active: true })
        const newItem: MasterDataItem = {
            id: `${type}_${Date.now()}`,
            name,
            active: true,
        }
        setItems((prev) => [...prev, newItem])
    }, [type])

    const deleteItem = useCallback((id: string) => {
        // TODO: await supabase.from(type).delete().eq('id', id)
        setItems((prev) => prev.filter((item) => item.id !== id))
    }, [])

    const toggleActive = useCallback((id: string) => {
        // TODO: await supabase.from(type).update({ active: !current }).eq('id', id)
        setItems((prev) =>
            prev.map((item) =>
                item.id === id ? { ...item, active: !item.active } : item
            )
        )
    }, [])

    const renameItem = useCallback((id: string, name: string) => {
        // TODO: await supabase.from(type).update({ name }).eq('id', id)
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
