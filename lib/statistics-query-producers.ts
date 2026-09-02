import { companyMatchScore, normalizeCompanyBaseName, normalizeCompanyName, type ProductionCompanyLegalEntity } from "@/lib/production-companies";

export type StatisticsProducerScope = "group" | "legal_entity";

export type ProducerCandidate = {
  id: string;
  name: string;
  score: number;
  scope: StatisticsProducerScope;
};

export type ProducerRegistryEmployer = {
  id: string;
  name: string;
  parent_id: string | null;
  employer_aliases?: Array<{ alias: string | null }> | null;
  employer_legal_entities?: Array<{
    id: string;
    legal_name: string | null;
    registration_number: string | null;
    entity_kind: string | null;
    is_primary: boolean | null;
    registration_status: string | null;
    website: string | null;
    archived_at: string | null;
  }> | null;
};

export type ResolvedStatisticsProducer = {
  ids: string[];
  name: string;
  scope: StatisticsProducerScope;
};

export type ProducerResolutionResult = {
  resolved: ResolvedStatisticsProducer[];
  ambiguous: null | { query: string; candidates: ProducerCandidate[] };
};

type ProducerOption = {
  employerId: string;
  parentId: string | null;
  canonicalName: string;
  aliases: string[];
  legalEntities: ProductionCompanyLegalEntity[];
};

type ProducerGroup = {
  rootId: string;
  name: string;
  ids: string[];
  options: ProducerOption[];
};

const legalEntityPattern = /\b(?:juridisk(?:e)?\s+enhed|juridisk(?:e)?\s+selskab|specifik(?:t|ke)?\s+(?:selskab|producent|enhed)|kun)\b/i;
const legalSuffixPattern = /\b(?:a\/s|aps|ap\/s|p\/s|i\/s|amba|s\.m\.b\.a\.|ltd|limited|inc|llc|ab|oy|gmbh)\b/i;

function toOption(employer: ProducerRegistryEmployer): ProducerOption {
  return {
    employerId: employer.id,
    parentId: employer.parent_id ?? null,
    canonicalName: employer.name,
    aliases: (employer.employer_aliases ?? []).map(alias => alias.alias).filter((alias): alias is string => Boolean(alias)),
    legalEntities: (employer.employer_legal_entities ?? [])
      .filter(entity => entity.legal_name && !entity.archived_at)
      .map(entity => ({
        id: entity.id,
        legalName: entity.legal_name!,
        registrationCountry: "DK",
        registrationType: "CVR",
        registrationNumber: entity.registration_number,
        entityKind: (entity.entity_kind ?? "company") as "company" | "subsidiary" | "spv",
        isPrimary: Boolean(entity.is_primary),
        registrationStatus: entity.registration_status,
        website: entity.website,
      })),
  };
}

function isSpecificLegalEntityQuery(question: string, producerName: string) {
  return legalEntityPattern.test(question) || legalSuffixPattern.test(producerName);
}

function exactNameMatch(option: ProducerOption, query: string) {
  const names = [option.canonicalName, ...option.aliases, ...option.legalEntities.map(entity => entity.legalName)];
  return names.some(candidate => normalizeCompanyBaseName(candidate) === normalizeCompanyBaseName(query));
}

function optionScore(option: ProducerOption, query: string) {
  return exactNameMatch(option, query) ? 200 : companyMatchScore({ ...option, isVerified: true }, query);
}

function producerGroups(options: ProducerOption[]) {
  const byId = new Map(options.map(option => [option.employerId, option]));
  const byRoot = new Map<string, ProducerGroup>();
  for (const option of options) {
    const root = option.parentId && byId.has(option.parentId) ? byId.get(option.parentId)! : option;
    const group = byRoot.get(root.employerId) ?? {
      rootId: root.employerId,
      name: root.canonicalName,
      ids: [],
      options: [],
    };
    group.ids.push(option.employerId);
    group.options.push(option);
    byRoot.set(root.employerId, group);
  }
  return [...byRoot.values()].map(group => ({ ...group, ids: [...new Set(group.ids)] }));
}

function displayGroupName(query: string, group: ProducerGroup) {
  const normalizedQuery = normalizeCompanyName(query);
  const normalizedRoot = normalizeCompanyName(group.name);
  if (normalizedQuery && normalizedRoot.includes(normalizedQuery)) return query.trim();
  return group.name;
}

function resolveOneProducerName(name: string, question: string, options: ProducerOption[]): ProducerResolutionResult {
  const specificLegalEntity = isSpecificLegalEntityQuery(question, name);

  if (specificLegalEntity) {
    const candidates = options.map(option => ({
      id: option.employerId,
      name: option.canonicalName,
      score: optionScore(option, name),
      scope: "legal_entity" as const,
    })).filter(candidate => candidate.score >= 50)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "da-DK"))
      .slice(0, 5);
    const best = candidates[0];
    const second = candidates[1];
    if (!best) return { resolved: [], ambiguous: { query: name, candidates: [] } };
    if (best.score < 100 || (second && best.score - second.score < 10)) return { resolved: [], ambiguous: { query: name, candidates } };
    return { resolved: [{ ids: [best.id], name: best.name, scope: "legal_entity" }], ambiguous: null };
  }

  const candidates = producerGroups(options).map(group => {
    const score = Math.max(...group.options.map(option => optionScore(option, name)));
    return {
      group,
      candidate: { id: group.rootId, name: displayGroupName(name, group), score, scope: "group" as const },
    };
  }).filter(entry => entry.candidate.score >= 50)
    .sort((left, right) => right.candidate.score - left.candidate.score || left.candidate.name.localeCompare(right.candidate.name, "da-DK"))
    .slice(0, 5);
  const best = candidates[0];
  const second = candidates[1];
  if (!best) return { resolved: [], ambiguous: { query: name, candidates: [] } };
  if (best.candidate.score < 100 || (second && best.candidate.score - second.candidate.score < 10)) {
    return { resolved: [], ambiguous: { query: name, candidates: candidates.map(entry => entry.candidate) } };
  }
  return {
    resolved: [{
      ids: best.group.ids,
      name: best.candidate.name,
      scope: "group",
    }],
    ambiguous: null,
  };
}

export function resolveStatisticsProducerNames(names: string[], question: string, employers: ProducerRegistryEmployer[]): ProducerResolutionResult {
  if (!names.length) return { resolved: [], ambiguous: null };
  const options = employers.map(toOption);
  const resolved: ResolvedStatisticsProducer[] = [];
  for (const name of names) {
    const result = resolveOneProducerName(name, question, options);
    if (result.ambiguous) return { resolved, ambiguous: result.ambiguous };
    for (const producer of result.resolved) {
      const key = `${producer.scope}:${producer.ids.join(",")}`;
      if (!resolved.some(item => `${item.scope}:${item.ids.join(",")}` === key)) resolved.push(producer);
    }
  }
  return { resolved, ambiguous: null };
}
