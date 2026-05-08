/**
 * Module-level reactive contract store.
 * Shared across all useContracts() instances in the same session.
 * TODO: replace with Supabase realtime subscriptions.
 */

import type { Contract } from "./types"
import { mockContracts } from "./mock-data"

type Listener = () => void

let _contracts: Contract[] = [...mockContracts]
const _listeners = new Set<Listener>()

export const contractStore = {
    getAll: (): Contract[] => _contracts,

    add: (contract: Contract): void => {
        _contracts = [contract, ..._contracts]
        _listeners.forEach((l) => l())
    },

    update: (id: string, updates: Partial<Contract>): void => {
        _contracts = _contracts.map((c) => (c.id === id ? { ...c, ...updates } : c))
        _listeners.forEach((l) => l())
    },

    remove: (id: string): void => {
        _contracts = _contracts.filter((c) => c.id !== id)
        _listeners.forEach((l) => l())
    },

    subscribe: (listener: Listener): (() => void) => {
        _listeners.add(listener)
        return () => _listeners.delete(listener)
    },
}
