import type { StatisticsFilters } from "@/lib/admin-statistics";
import {
  StatisticsQueryPlanError,
  type StatisticsComparisonDimension,
  type StatisticsQueryPlan,
} from "@/lib/statistics-query-plan";

export type ResolvedStatisticsProducer = { id: string; name: string };

export type StatisticsQuerySegment = {
  filters: StatisticsFilters;
  key: string;
  label: string;
  dimensions: Partial<Record<StatisticsComparisonDimension, string>>;
  overlappingCategories: boolean;
};

const categoryLabels: Record<string, string> = {
  feature: "Spillefilm",
  tvSeries: "TV-serie",
  documentary: "Dokumentarfilm",
  docSeries: "Dokumentarserie",
  short: "Kortfilm",
  tvEntertainment: "TV-underholdning",
  reality: "Reality",
  other: "Andet",
};
const contractTypeLabels: Record<string, string> = { "a-løn": "A-løn", leverandør: "Leverandør" };
const genderLabels: Record<string, string> = { female: "Kvinder", male: "Mænd", other: "Andet køn" };
const membershipLabels: Record<string, string> = { member: "Medlem", associate: "Tilknyttet medlem", none: "Ikke medlem", unknown: "Ukendt medlemsstatus" };
const experienceLabels: Record<string, string> = { new_graduate: "0–3 års erfaring", early_career: "4–7 års erfaring", experienced: "8–17 års erfaring", veteran: "18+ års erfaring" };

type DimensionValue = { value: string; label: string; id?: string };

function valuesForDimension(
  dimension: StatisticsComparisonDimension,
  plan: StatisticsQueryPlan,
  producers: ResolvedStatisticsProducer[],
): DimensionValue[] {
  if (dimension === "category") return plan.filters.categories.map(value => ({ value, label: categoryLabels[value] ?? value }));
  if (dimension === "contract_type") return plan.filters.contractTypes.map(value => ({ value, label: contractTypeLabels[value] ?? value }));
  if (dimension === "producer") return producers.map(producer => ({ value: producer.name, label: producer.name, id: producer.id }));
  if (dimension === "gender") return plan.filters.genders.map(value => ({ value, label: genderLabels[value] ?? value }));
  if (dimension === "producer_type") return plan.filters.producerTypeCodes.map(value => ({ value, label: value.replaceAll("_", " ") }));
  if (dimension === "membership_type") return plan.filters.membershipTypes.map(value => ({ value, label: membershipLabels[value] ?? value }));
  if (dimension === "profession_type") return plan.filters.professionTypes.map(value => ({ value, label: value }));
  return plan.filters.experienceGroups.map(value => ({ value, label: experienceLabels[value] ?? value }));
}

function cartesian<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>((results, values) => results.flatMap(result => values.map(value => [...result, value])), [[]]);
}

function safeKey(value: string) {
  return value.toLocaleLowerCase("da").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "result";
}

export function buildStatisticsQuerySegments(
  plan: StatisticsQueryPlan,
  producers: ResolvedStatisticsProducer[],
): StatisticsQuerySegment[] {
  const dimensions = plan.compareBy.map(dimension => ({ dimension, values: valuesForDimension(dimension, plan, producers) }));
  if (dimensions.some(entry => entry.values.length === 0)) {
    throw new StatisticsQueryPlanError("missing_comparison_values", "Sammenligningen mangler konkrete grupper.");
  }
  const combinations = dimensions.length ? cartesian(dimensions.map(entry => entry.values)) : [[]];
  if (combinations.length * plan.metrics.length > 24) {
    throw new StatisticsQueryPlanError("too_many_series", "Forespørgslen giver for mange samtidige serier.");
  }

  return combinations.map(values => {
    const selected = new Map(plan.compareBy.map((dimension, index) => [dimension, values[index]]));
    const producerSelection = selected.get("producer");
    const filters: StatisticsFilters = {
      years: plan.filters.years,
      genders: selected.has("gender") ? [selected.get("gender")!.value] : plan.filters.genders,
      categories: selected.has("category") ? [selected.get("category")!.value] : plan.filters.categories,
      contractTypes: selected.has("contract_type") ? [selected.get("contract_type")!.value] : plan.filters.contractTypes,
      producerIds: producerSelection?.id
        ? [producerSelection.id]
        : producers.length ? producers.map(producer => producer.id) : [],
      producerTypeCodes: selected.has("producer_type") ? [selected.get("producer_type")!.value] : plan.filters.producerTypeCodes,
      membershipTypes: selected.has("membership_type") ? [selected.get("membership_type")!.value] : plan.filters.membershipTypes,
      professionTypes: selected.has("profession_type") ? [selected.get("profession_type")!.value] : plan.filters.professionTypes,
      experienceGroups: (selected.has("experience_group") ? [selected.get("experience_group")!.value] : plan.filters.experienceGroups) as StatisticsFilters["experienceGroups"],
    };
    const labels = values.map(value => value.label);
    const keyParts = plan.compareBy.map((dimension, index) => `${dimension}-${safeKey(values[index].value)}`);
    return {
      filters,
      key: keyParts.join("__") || "result",
      label: labels.join(" · ") || "Samlet resultat",
      dimensions: Object.fromEntries(plan.compareBy.map((dimension, index) => [dimension, values[index].value])),
      overlappingCategories: plan.compareBy.some(dimension => dimension === "producer_type" || dimension === "membership_type"),
    };
  });
}

export function describeStatisticsPlan(plan: StatisticsQueryPlan) {
  const comparisons = plan.compareBy.map(dimension => ({
    category: "produktionstype",
    contract_type: "kontrakttype",
    producer: "producent",
    gender: "køn",
    producer_type: "producenttype",
    membership_type: "medlemsstatus",
    profession_type: "faggruppe",
    experience_group: "erfaringsgruppe",
  })[dimension]);
  const years = plan.filters.years;
  const period = years.length === 1 ? String(years[0])
    : years.length > 1 ? `${years[0]}–${years.at(-1)}`
      : "alle år";
  return `Resultatet er grupperet pr. år for ${period}${comparisons.length ? ` og sammenlignet efter ${comparisons.join(" og ")}` : ""}.`;
}
