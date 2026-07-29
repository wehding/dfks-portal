"use client";

import { useEffect, useMemo, useState } from "react";
import { Columns3, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

type Column = { id: string; label: string; index: number; required?: boolean };

export function AdminListTools({ pageKey, title, columns }: { pageKey: string; title: string; columns: Column[] }) {
  const storageKey = `dfks:admin-columns:${pageKey}`;
  const [visible, setVisible] = useState(() => new Set(columns.map(column => column.id)));
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(stored)) setVisible(new Set([...stored, ...columns.filter(column => column.required).map(column => column.id)]));
    } catch { /* Behold standardkolonner. */ }
    // Kolonnedefinitionerne er sidekonfiguration; localStorage genlæses kun ved sideskift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const hiddenRules = useMemo(() => columns.filter(column => !visible.has(column.id))
    .map(column => `main table:first-of-type tr > :nth-child(${column.index}){display:none!important}`).join("\n"), [columns, visible]);
  const toggle = (column: Column) => {
    if (column.required) return;
    setVisible(current => {
      const next = new Set(current);
      if (next.has(column.id)) next.delete(column.id); else next.add(column.id);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };
  const print = () => {
    const previous = document.title;
    document.title = `${title} – ${new Date().toLocaleDateString("da-DK")}`;
    window.print();
    window.setTimeout(() => { document.title = previous; }, 100);
  };
  return <div className="flex flex-wrap justify-end gap-2 print:hidden">
    <details className="relative">
      <summary className="list-none"><Button type="button" variant="outline" size="sm" asChild><span><Columns3 className="mr-2 h-4 w-4" />Vælg kolonner</span></Button></summary>
      <div className="absolute right-0 z-30 mt-2 min-w-56 space-y-1 rounded-md border bg-popover p-2 text-sm shadow-lg">
        {columns.map(column => <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
          <input type="checkbox" checked={visible.has(column.id)} disabled={column.required} onChange={() => toggle(column)} />
          {column.label}
        </label>)}
      </div>
    </details>
    <Button type="button" variant="outline" size="sm" onClick={print}><Printer className="mr-2 h-4 w-4" />Udskriv / PDF</Button>
    {hiddenRules && <style>{hiddenRules}</style>}
  </div>;
}
