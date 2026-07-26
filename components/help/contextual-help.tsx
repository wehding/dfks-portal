"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
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
  const buttonLabel = label === "Hjælp" ? t("help.button") : label;
  return (
    <Button type="button" variant="outline" onClick={onClick} className={className} aria-label={buttonLabel} title={buttonLabel}>
      <HelpCircle className="h-4 w-4" />
      <span>{buttonLabel}</span>
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

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-14 z-[60] bg-black/35"
      onClick={event => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <aside role="dialog" aria-modal="true" aria-labelledby="contextual-help-title" className="absolute bottom-0 right-0 flex h-[min(72dvh,42rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-b-0 bg-background pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl sm:inset-y-0 sm:h-full sm:max-w-md sm:rounded-none sm:border-y-0 sm:border-r-0 sm:pb-0">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="contextual-help-title" className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("help.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {topics.map(topic => (
            <section key={topic.title} className="rounded-lg border bg-card p-4 text-card-foreground">
              <h3 className="text-sm font-semibold text-foreground">{topic.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{topic.body}</p>
              {topic.tips && topic.tips.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {topic.tips.map(tip => (
                    <li key={tip} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
