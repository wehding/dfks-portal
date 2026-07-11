export const WORK_TYPES = [
  { value: "dokumentarfilm", label: "Dokumentarfilm" },
  { value: "dokumentar-serie", label: "Dokumentarserie" },
  { value: "tv-serie", label: "Tv-serie" },
  { value: "spillefilm", label: "Spillefilm" },
  { value: "kortfilm", label: "Kortfilm" },
  { value: "dokudrama", label: "Dokudrama" },
] as const;

export type WorkTypeValue = (typeof WORK_TYPES)[number]["value"];

export const WORK_TYPE_VALUES = WORK_TYPES.map(type => type.value) as WorkTypeValue[];

export function workTypeLabel(value: string | null | undefined) {
  return WORK_TYPES.find(type => type.value === value)?.label ?? value ?? "-";
}

export function isSeriesWorkType(value: string | null | undefined) {
  return value === "tv-serie" || value === "dokumentar-serie";
}
