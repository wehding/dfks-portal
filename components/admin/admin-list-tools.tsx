"use client";

import { useEffect, useMemo, useState } from "react";
import { Columns3, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";

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
  return <div data-explicit-admin-list-tools className="flex flex-wrap justify-end gap-2 print:hidden">
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

export function AdminListAutoTools() {
  const pathname = usePathname();
  const [columns, setColumns] = useState<Column[]>([]);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  useEffect(() => {
    const inspect = () => {
      if (document.querySelector("[data-explicit-admin-list-tools]")) return setColumns([]);
      const headers = [...document.querySelectorAll("main table:first-of-type thead th")];
      const discovered = headers.map((header, index) => ({ id: `column-${index + 1}`, label: header.textContent?.trim() || `Kolonne ${index + 1}`, index: index + 1, required: index === 0 }));
      setColumns(current => current.length === discovered.length && current.every((column, index) => column.label === discovered[index]?.label) ? current : discovered);
    };
    inspect();
    const observer = new MutationObserver(inspect);
    const main = document.querySelector("main");
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
  useEffect(() => {
    if (!columns.length) return;
    const key = `dfks:admin-columns:auto:${pathname}`;
    let next: Set<string>;
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      next = new Set(Array.isArray(stored) ? [...stored, columns[0].id] : columns.map(column => column.id));
    } catch { next = new Set(columns.map(column => column.id)); }
    const frame = requestAnimationFrame(() => setVisible(next));
    return () => cancelAnimationFrame(frame);
  }, [columns, pathname]);
  if (!columns.length) return null;
  const key = `dfks:admin-columns:auto:${pathname}`;
  const hiddenRules = columns.filter(column => !visible.has(column.id)).map(column => `main table:first-of-type tr > :nth-child(${column.index}){display:none!important}`).join("\n");
  const toggle = (column: Column) => {
    if (column.required) return;
    setVisible(current => {
      const next = new Set(current);
      if (next.has(column.id)) next.delete(column.id); else next.add(column.id);
      localStorage.setItem(key, JSON.stringify([...next]));
      return next;
    });
  };
  return <div className="fixed bottom-4 right-20 z-40 flex gap-2 rounded-lg border bg-background p-2 shadow-lg print:hidden">
    <details className="relative"><summary className="list-none"><Button variant="outline" size="sm" asChild><span><Columns3 className="mr-2 h-4 w-4" />Vælg kolonner</span></Button></summary>
      <div className="absolute bottom-full right-0 mb-2 min-w-56 space-y-1 rounded-md border bg-popover p-2 text-sm shadow-lg">{columns.map(column => <label key={column.id} className="flex items-center gap-2 px-2 py-1"><input type="checkbox" checked={visible.has(column.id)} disabled={column.required} onChange={() => toggle(column)} />{column.label}</label>)}</div>
    </details>
    <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Udskriv / PDF</Button>
    {hiddenRules && <style>{hiddenRules}</style>}
  </div>;
}
