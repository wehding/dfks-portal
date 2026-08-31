import { BadgeCheck, Clapperboard, Database, Film, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dataSourceLabel, normalizeDataSource } from "@/lib/source-pictograms";

export function SourcePictogram({ source, className = "" }: { source: string; className?: string }) {
  const kind = normalizeDataSource(source);
  const Icon = kind === "db"
    ? Database
    : kind === "dfi"
      ? Clapperboard
      : kind === "tmdb"
        ? Film
        : kind === "imdb"
          ? BadgeCheck
          : UserRound;
  const label = dataSourceLabel(source);
  return <Badge variant="outline" className={`h-5 gap-1 px-1.5 text-[10px] font-semibold ${className}`} title={`Kilde: ${label}`}>
    <Icon className="h-3 w-3" aria-hidden="true" />
    <span>{label}</span>
  </Badge>;
}
