"use client";

import type { PersonCandidate } from "@/app/actions/person-discovery";
import { Loader2 } from "lucide-react";

export function PersonIdentityPicker({ candidates, selected, loading, error, onSelect }: {
  candidates: PersonCandidate[];
  selected: Record<string, boolean>;
  loading: boolean;
  error?: string | null;
  onSelect: (candidate: PersonCandidate) => void;
}) {
  if (loading) return <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Søger efter navnevarianter…</div>;
  return <div className="space-y-5">
    {(["dfi", "tmdb", "wikidata"] as const).map(source => {
      const sourceCandidates = candidates.filter(candidate => candidate.source === source);
      return <section key={source} className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{source}</h3>
        {sourceCandidates.length === 0 ? <p className="text-sm text-muted-foreground">Ingen sandsynlige profiler fundet.</p> : sourceCandidates.map(candidate => {
          const checked = Boolean(selected[candidate.key]);
          const reason = candidate.reason === "exact" ? "Matcher dit fulde navn" : candidate.reason === "without-middle-name" ? "Matcher uden mellemnavn" : candidate.reason === "initial-variant" ? "Matcher med initial" : "Tæt stavematch";
          return <button type="button" aria-pressed={checked} onClick={() => onSelect(candidate)} key={candidate.key} className={`flex w-full cursor-pointer gap-3 rounded-lg border p-3 text-left ${checked ? "border-foreground bg-muted ring-1 ring-foreground" : "hover:bg-muted/50"}`}>
            <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${checked ? "bg-foreground text-background" : "bg-background"}`}>{checked ? "✓" : ""}</span>
            {candidate.imageUrl && <img src={candidate.imageUrl} alt="" className="h-14 w-11 rounded object-cover" />}
            <span className="min-w-0"><strong className="block text-sm">{candidate.name}</strong><span className="block text-xs text-muted-foreground">{reason}</span>{candidate.description && <span className="mt-1 block text-xs text-muted-foreground">{candidate.description}</span>}{candidate.knownFor.length > 0 && <span className="mt-1 block text-xs text-muted-foreground">Kendt for: {candidate.knownFor.join(", ")}</span>}</span>
          </button>;
        })}
      </section>;
    })}
    {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
  </div>;
}
