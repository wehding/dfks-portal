import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildAssociationPreview,
  normalizeMembershipType,
  normalizeSourceWebsite,
  type ProducerAssociationPreviewItem,
} from "@/lib/producer-association";
import { normalizeCompanyBaseName } from "@/lib/production-companies";
import { fetchProducentforeningenMemberships } from "@/lib/server/producer-association-source";

type ApplyDecision = { sourceKey: string; action: "match" | "create" | "skip"; employerId?: string | null };
type EmployerRow = {
  id: string;
  name: string;
  is_verified: boolean | null;
  employer_aliases: Array<{ alias: string }> | null;
  employer_legal_entities: Array<{ id: string; legal_name: string; registration_number: string | null; website: string | null; archived_at: string | null }> | null;
};

async function producerOptions(db: ReturnType<typeof createServiceClient>) {
  const { data, error } = await db.from("employers")
    .select("id,name,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_number,website,archived_at)")
    .is("merged_into_id", null)
    .is("archived_at", null);
  if (error) throw new Error("De eksisterende producenter kunne ikke hentes.");
  return ((data ?? []) as unknown as EmployerRow[]).map(employer => ({
    employerId: employer.id,
    canonicalName: employer.name,
    aliases: (employer.employer_aliases ?? []).map(alias => alias.alias),
    legalEntities: (employer.employer_legal_entities ?? []).filter(entity => !entity.archived_at).map(entity => ({
      id: entity.id,
      legalName: entity.legal_name,
      registrationCountry: "DK",
      registrationType: "CVR",
      registrationNumber: entity.registration_number,
      entityKind: "company" as const,
      isPrimary: false,
      registrationStatus: null,
      website: entity.website,
    })),
    websites: (employer.employer_legal_entities ?? []).filter(entity => !entity.archived_at).map(entity => entity.website ?? "").filter(Boolean),
    isVerified: Boolean(employer.is_verified),
  }));
}

export async function GET() {
  const auth = await requireAdminApi(["superadmin", "admin", "org-admin"]);
  if (!auth.ok) return auth.response;
  const db = createServiceClient();
  const { data, error } = await db.from("producer_association_sync_runs")
    .select("id,status,verified_on,source_rows,unique_producers,matched_count,created_count,review_count,changed_count,missing_count,created_at,applied_at,error_message")
    .eq("association_code", "producentforeningen")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Synkroniseringsstatus kunne ikke hentes." }, { status: 500 });
  return NextResponse.json({ lastRun: data ?? null });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(["superadmin", "admin", "org-admin"]);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as { action?: string; runId?: string; decisions?: ApplyDecision[] } | null;
  if (body?.action === "preview") return previewSync(auth.userId);
  if (body?.action === "apply") return applySync(auth.userId, body.runId, body.decisions);
  return NextResponse.json({ error: "Ugyldig synkroniseringshandling." }, { status: 400 });
}

async function previewSync(userId: string) {
  const db = createServiceClient();
  try {
    const [{ rows, verifiedOn }, employers, currentResult] = await Promise.all([
      fetchProducentforeningenMemberships(),
      producerOptions(db),
      db.from("employer_producer_types").select("source_name,producer_types(code)").eq("source", "producentforeningen").eq("is_active", true),
    ]);
    if (currentResult.error) throw new Error("Eksisterende medlemsdata kunne ikke hentes.");
    const items = buildAssociationPreview(rows, employers);
    const sourceKeys = new Set(rows.map(row => `${normalizeCompanyBaseName(row.sourceName)}:${row.groupCode}`));
    const missingCount = (currentResult.data ?? []).filter(row => {
      const type = Array.isArray(row.producer_types) ? row.producer_types[0] : row.producer_types;
      const sourceGroup = type?.code === "feature_fiction" ? "fiction" : type?.code;
      return !sourceKeys.has(`${normalizeCompanyBaseName(row.source_name ?? "")}:${sourceGroup}`);
    }).length;
    const matchedCount = items.filter(item => item.recommendation === "match").length;
    const reviewCount = items.filter(item => item.recommendation === "review").length;
    const createCount = items.filter(item => item.recommendation === "create").length;
    const summary = { sourceRows: rows.length, uniqueProducers: items.length, matchedCount, reviewCount, createCount, missingCount };
    const { data: run, error } = await db.from("producer_association_sync_runs").insert({
      status: "preview",
      verified_on: verifiedOn,
      source_rows: rows.length,
      unique_producers: items.length,
      matched_count: matchedCount,
      review_count: reviewCount,
      missing_count: missingCount,
      snapshot: items,
      summary,
      created_by: userId,
    }).select("id").single();
    if (error || !run) throw new Error("Forhåndsvisningen kunne ikke gemmes.");
    return NextResponse.json({ runId: run.id, verifiedOn, items, summary });
  } catch (error) {
    console.error("[producentforeningen] preview failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Medlemslisten kunne ikke hentes." }, { status: 502 });
  }
}

async function applySync(userId: string, runId?: string, decisionsInput?: ApplyDecision[]) {
  if (!runId || !Array.isArray(decisionsInput) || decisionsInput.length > 250) {
    return NextResponse.json({ error: "Synkroniseringsvalgene er ugyldige." }, { status: 400 });
  }
  const decisions = new Map(decisionsInput.map(decision => [decision.sourceKey, decision]));
  const db = createServiceClient();
  const { data: run, error: runError } = await db.from("producer_association_sync_runs")
    .select("id,status,verified_on,snapshot")
    .eq("id", runId)
    .eq("association_code", "producentforeningen")
    .maybeSingle();
  if (runError || !run) return NextResponse.json({ error: "Forhåndsvisningen blev ikke fundet." }, { status: 404 });
  if (run.status !== "preview") return NextResponse.json({ error: "Forhåndsvisningen er allerede behandlet." }, { status: 409 });
  const items = run.snapshot as unknown as ProducerAssociationPreviewItem[];
  if (!Array.isArray(items) || items.length > 250) return NextResponse.json({ error: "Forhåndsvisningen er beskadiget." }, { status: 409 });

  let createdCount = 0;
  let matchedCount = 0;
  let changedCount = 0;
  const skipped: string[] = [];
  try {
    const requestedEmployerIds = [...new Set(decisionsInput.map(decision => decision.employerId).filter((id): id is string => Boolean(id)))];
    const validEmployerIds = new Set<string>();
    if (requestedEmployerIds.length) {
      const existingResult = await db.from("employers").select("id").in("id", requestedEmployerIds).is("merged_into_id", null).is("archived_at", null);
      if (existingResult.error) throw new Error("Valgte producenter kunne ikke kontrolleres.");
      for (const employer of existingResult.data ?? []) validEmployerIds.add(employer.id);
    }

    for (const item of items) {
      const decision = decisions.get(item.sourceKey) ?? { sourceKey: item.sourceKey, action: "skip" as const };
      if (decision.action === "skip") { skipped.push(item.sourceName); continue; }
      let employerId = decision.employerId ?? null;
      if (decision.action === "match") {
        if (!employerId || !validEmployerIds.has(employerId)) throw new Error(`Producentmatch for “${item.sourceName}” er ikke længere gyldigt.`);
        matchedCount += 1;
      } else {
        const { data: created, error: createError } = await db.from("employers").insert({
          name: item.sourceName,
          status: "active",
          is_verified: false,
          associeret: item.groups.some(group => normalizeMembershipType(group.membershipType) === "associate"),
        }).select("id").single();
        if (createError || !created) throw new Error(`“${item.sourceName}” kunne ikke oprettes: ${createError?.message ?? "ukendt fejl"}`);
        employerId = created.id;
        createdCount += 1;
      }

      const { data: employer } = await db.from("employers").select("name,associeret,employer_aliases(alias)").eq("id", employerId).single();
      const aliases = (employer?.employer_aliases ?? []) as Array<{ alias: string }>;
      if (employer && normalizeCompanyBaseName(employer.name) !== normalizeCompanyBaseName(item.sourceName)
        && !aliases.some(alias => normalizeCompanyBaseName(alias.alias) === normalizeCompanyBaseName(item.sourceName))) {
        const aliasResult = await db.from("employer_aliases").insert({ employer_id: employerId, alias: item.sourceName, alias_type: "imported", source: "producentforeningen", created_by: userId });
        if (aliasResult.error && aliasResult.error.code !== "23505") throw new Error(aliasResult.error.message);
      }

      for (const group of item.groups) {
        const membershipType = normalizeMembershipType(group.membershipType);
        const typeCode = group.groupCode === "fiction" ? "feature_fiction" : group.groupCode;
        const { data: producerType, error: producerTypeError } = await db.from("producer_types")
          .select("id").eq("code", typeCode).single();
        if (producerTypeError || !producerType) throw new Error(`Producenttypen “${group.groupLabel}” blev ikke fundet.`);
        const membershipResult = await db.from("employer_producer_types").upsert({
          employer_id: employerId,
          producer_type_id: producerType.id,
          source: "producentforeningen",
          membership_type: membershipType === "ordinary" ? "member" : membershipType,
          source_name: group.sourceName,
          source_url: group.sourceUrl,
          source_identifier: `producentforeningen:${group.groupCode}`,
          source_metadata: {
            group_label: group.groupLabel,
            owner_ceo_text: group.ownerCeoText,
            website: normalizeSourceWebsite(group.website),
            address: group.address,
            postal_city: group.postalCity,
            source_hash: group.sourceHash ?? null,
          },
          is_active: true,
          verified_on: run.verified_on,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: userId,
        }, { onConflict: "employer_id,producer_type_id,source" });
        if (membershipResult.error) throw new Error(`Medlemsdata for “${item.sourceName}” kunne ikke gemmes: ${membershipResult.error.message}`);
        changedCount += 1;
      }

      const knownTypes = item.groups.map(group => normalizeMembershipType(group.membershipType)).filter(type => type !== "unknown");
      if (knownTypes.length) {
        const associationUpdate = await db.from("employers").update({ associeret: knownTypes.includes("associate"), updated_at: new Date().toISOString() }).eq("id", employerId);
        if (associationUpdate.error) throw new Error(associationUpdate.error.message);
      }
    }

    const updateResult = await db.from("producer_association_sync_runs").update({
      status: "applied",
      matched_count: matchedCount,
      created_count: createdCount,
      changed_count: changedCount,
      review_count: skipped.length,
      applied_at: new Date().toISOString(),
      summary: { matchedCount, createdCount, changedCount, skippedCount: skipped.length },
    }).eq("id", runId).eq("status", "preview");
    if (updateResult.error) throw new Error(updateResult.error.message);
    return NextResponse.json({ success: true, matchedCount, createdCount, changedCount, skipped });
  } catch (error) {
    console.error("[producentforeningen] apply failed", error);
    await db.from("producer_association_sync_runs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Ukendt fejl" }).eq("id", runId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Synkroniseringen fejlede." }, { status: 409 });
  }
}
