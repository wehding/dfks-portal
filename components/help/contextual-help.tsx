"use client";

import { useEffect } from "react";
import { HelpCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export type HelpTopic = {
  title: string;
  body: string;
  tips?: string[];
};

type ContextualHelpProps = {
  title: string;
  intro: string;
  topics: HelpTopic[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageKey?: string;
};

export function HelpButton({ onClick, label = "Hjælp", className = "w-full gap-2 sm:w-auto" }: { onClick: () => void; label?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <Button type="button" variant="outline" onClick={onClick} className={className}>
      <HelpCircle className="h-4 w-4" />
      {label === "Hjælp" ? t("help.button") : label}
    </Button>
  );
}

export function ContextualHelp({ title, intro, topics, open, onOpenChange, storageKey }: ContextualHelpProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    if (window.localStorage.getItem(storageKey) === "seen") return;
    window.localStorage.setItem(storageKey, "seen");
    onOpenChange(true);
  }, [onOpenChange, storageKey]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/35"
      onClick={event => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <aside className="ml-auto mt-auto flex h-[min(92svh,42rem)] w-full flex-col rounded-t-2xl border-l bg-background text-foreground shadow-xl sm:mt-0 sm:h-full sm:max-w-md sm:rounded-none">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-gray-500">{intro}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("help.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {topics.map(topic => (
            <section key={topic.title} className="rounded-lg border bg-card p-4 text-card-foreground">
              <h3 className="text-sm font-semibold text-foreground">{topic.title}</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">{topic.body}</p>
              {topic.tips && topic.tips.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm text-gray-600">
                  {topic.tips.map(tip => (
                    <li key={tip} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-900" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
