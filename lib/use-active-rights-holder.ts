"use client";

import { useCallback, useEffect, useState } from "react";

export type ActiveRightsHolder = { id: string; name: string } | null;

const STORAGE_KEY = "dfks_active_rh";
const CHANGE_EVENT = "dfks-active-rh-change";

function readActiveRightsHolder(): ActiveRightsHolder {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown };
    if (typeof parsed.id === "string" && typeof parsed.name === "string") {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

export function useActiveRightsHolder() {
  const [activeRh, setActiveRhState] = useState<ActiveRightsHolder>(null);

  useEffect(() => {
    const handleChange = () => setActiveRhState(readActiveRightsHolder());
    window.setTimeout(handleChange, 0);
    window.addEventListener("storage", handleChange);
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => {
      window.removeEventListener("storage", handleChange);
      window.removeEventListener(CHANGE_EVENT, handleChange);
    };
  }, []);

  const setActiveRh = useCallback((next: ActiveRightsHolder) => {
    if (typeof window !== "undefined") {
      if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
    setActiveRhState(next);
  }, []);

  return { activeRh, setActiveRh };
}
