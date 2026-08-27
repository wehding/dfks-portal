"use server"

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase relation payloads are normalized at this server boundary. */

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { calculateAftalelicensPoints, DEFAULT_AFTALELICENS_WEIGHT_EXTRA, DEFAULT_AFTALELICENS_WEIGHTS } from "@/lib/aftalelicens-points"
import { applyAftalelicensRerunFactor, markAftalelicensReruns } from "@/lib/aftalelicens-reruns"
import { errorMessage } from "@/lib/error-message"
import { allocateByLargestRemainder } from "@/lib/rights-largest-remainder"
import { computePolicyPreview, type PolicyComponent } from "@/lib/rights-policy-preview"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import type { AftalelicensVaegtExtra, AftalelicensVaerk, VaerkType } from "@/lib/streaming-types"

const ADMIN_ROLES = ["superadmin", "admin", "org-admin"] as const

const transferSchema = z.object({
  batchId: z.string().min(1).max(200),
  fundId: z.string().uuid(),
  policyVersionId: z.string().uuid(),
  grossAmountMinor: z.number().int().nonnegative().safe(),
  expectedPreview: z.object({
    admin: z.number().int().nonnegative().safe(),
    claimReserve: z.number().int().nonnegative().safe(),
    social: z.number().int().nonnegative().safe(),
    individual: z.number().int().nonnegative().safe(),
  }),
  matches: z.array(z.object({
    sourceRowId: z.string().uuid(),
    workId: z.string().uuid(),
    episodeId: z.string().uuid().nullable().optional(),
  })).min(1).max(20_000),
})

type WeightConfig = {
  weights?: Partial<Record<VaerkType, number>>
  extra?: Partial<AftalelicensVaegtExtra>
}

export type AftalelicensTransferOption = {
  fundId: string
  fundName: string
  currency: string
  policyVersionId: string
  policyName: string
  policyVersionNumber: number
}

export async function getAftalelicensTransferOptions(): Promise<{
  success: boolean
  enabled: boolean
  options: AftalelicensTransferOption[]
  error?: string
}> {
  try {
    const caller = await assertAdminRole(await createClient(), ADMIN_ROLES)
    if (!caller) throw new Error("Ingen adgang")
    const db = createServiceClient()
    const [{ data: organisation, error: orgError }, { data: versions, error: versionError }] = await Promise.all([
      db.from("organisations").select("rights_calculation_transfer_enabled").eq("id", caller.orgId).single(),
      db.from("distribution_policy_versions").select(`
        id, version_number,
        distribution_policies!inner(id, name, fund_id, rights_funds!inner(id, name, currency, active))
      `).eq("org_id", caller.orgId).eq("status", "active"),
    ])
    if (orgError) throw orgError
    if (versionError) throw versionError

    const options = (versions ?? []).flatMap((version: any): AftalelicensTransferOption[] => {
      const policy = Array.isArray(version.distribution_policies)
        ? version.distribution_policies[0]
        : version.distribution_policies
      const fund = Array.isArray(policy?.rights_funds) ? policy.rights_funds[0] : policy?.rights_funds
      if (!policy || !fund?.active) return []
      return [{
        fundId: fund.id,
        fundName: fund.name,
        currency: fund.currency,
        policyVersionId: version.id,
        policyName: policy.name,
        policyVersionNumber: version.version_number,
      }]
    })
    return { success: true, enabled: organisation.rights_calculation_transfer_enabled === true, options }
  } catch (error) {
    return { success: false, enabled: false, options: [], error: errorMessage(error) }
  }
}

export async function transferAftalelicensBatchToRights(input: unknown): Promise<{
  success: boolean
  runId?: string
  created?: boolean
  error?: string
}> {
  try {
    const payload = transferSchema.parse(input)
    const caller = await assertAdminRole(await createClient(), ADMIN_ROLES)
    if (!caller) throw new Error("Ingen adgang")
    const db = createServiceClient()

    const [
      { data: organisation, error: orgError },
      { data: batch, error: batchError },
      { data: policy, error: policyError },
      { data: fund, error: fundError },
    ] = await Promise.all([
      db.from("organisations").select("rights_calculation_transfer_enabled, aftalelicens_weight_config").eq("id", caller.orgId).single(),
      db.from("aftalelicens_batches").select("id, year, kilde").eq("id", payload.batchId).eq("org_id", caller.orgId).single(),
      db.from("distribution_policy_versions").select(`
        id, status, admin_rate_bps, distribution_policy_components(*),
        distribution_policies!inner(id, name, fund_id, claim_period_years)
      `).eq("id", payload.policyVersionId).eq("org_id", caller.orgId).single(),
      db.from("rights_funds").select("id,currency,active").eq("id", payload.fundId).eq("org_id", caller.orgId).single(),
    ])
    if (orgError) throw orgError
    if (batchError) throw batchError
    if (policyError) throw policyError
    if (fundError) throw fundError
    if (!organisation.rights_calculation_transfer_enabled) {
      throw new Error("Databaseoverførsel er endnu ikke aktiveret for organisationen.")
    }

    const policyRelation = Array.isArray((policy as any).distribution_policies)
      ? (policy as any).distribution_policies[0]
      : (policy as any).distribution_policies
    if (!fund.active || policy.status !== "active" || policyRelation?.fund_id !== payload.fundId) {
      throw new Error("Den valgte aktive fordelingspolitik tilhører ikke rettighedskassen.")
    }

    const matchBySource = new Map(payload.matches.map((match) => [match.sourceRowId, match]))
    if (matchBySource.size !== payload.matches.length) throw new Error("Samme kilderække er matchet mere end én gang.")

    const { data: sourceRows, error: sourceError } = await db.from("screening_source_rows")
      .select("id,title,screening_date,broadcast_time,duration_minutes,season,episode,episode_id,episode_title,category,sort_status,vaerk_type")
      .eq("org_id", caller.orgId).eq("batch_key", payload.batchId).eq("sort_status", "approved")
      .order("screening_date").order("id")
    if (sourceError) throw sourceError
    if (!sourceRows?.length) throw new Error("Batchen har ingen godkendte kilderækker.")
    if (sourceRows.some((row) => !matchBySource.has(row.id)) || matchBySource.size !== sourceRows.length) {
      throw new Error("Alle og kun de godkendte kilderækker skal være bekræftet matchet før overførsel.")
    }

    const workIds = Array.from(new Set(payload.matches.map((match) => match.workId)))
    const { data: works, error: worksError } = await db.from("works")
      .select("id,type,aftalelicens_rights_eligible").eq("org_id", caller.orgId).in("id", workIds)
    if (worksError) throw worksError
    if (works?.length !== workIds.length || works.some((work) => !work.aftalelicens_rights_eligible)) {
      throw new Error("Et matchet værk findes ikke i organisationen eller er ikke rettighedsberettiget.")
    }
    const workById = new Map((works ?? []).map((work) => [work.id, work]))

    const rawConfig = (organisation.aftalelicens_weight_config ?? {}) as WeightConfig
    const weights = { ...DEFAULT_AFTALELICENS_WEIGHTS, ...(rawConfig.weights ?? {}) }
    const extra = { ...DEFAULT_AFTALELICENS_WEIGHT_EXTRA, ...(rawConfig.extra ?? {}) }
    const rerunInput: AftalelicensVaerk[] = sourceRows.map((row) => ({
      id: row.id,
      batchId: payload.batchId,
      rawTitle: row.title,
      channel: "",
      broadcastDate: row.screening_date ?? undefined,
      broadcastTime: row.broadcast_time ?? undefined,
      duration: row.duration_minutes ?? undefined,
      season: row.season ?? undefined,
      episode: row.episode ?? undefined,
      episodeId: row.episode_id ?? undefined,
      episodeTitle: row.episode_title ?? undefined,
      vaerkType: row.vaerk_type as VaerkType,
      sortStatus: "approved",
    }))
    const rerunRows = markAftalelicensReruns(rerunInput, extra.genudsendelseMaaneder)
    const weightedRows = rerunRows.map((row) => {
      const match = matchBySource.get(row.id)!
      const work = workById.get(match.workId)!
      const workType = (row.vaerkType || work.type) as VaerkType | undefined
      if (!workType || !(workType in weights)) throw new Error(`Værktype mangler for kilderækken ${row.id}.`)
      const calculated = calculateAftalelicensPoints(workType, row.duration, weights, extra)
      const points = applyAftalelicensRerunFactor(calculated.points, row.isGenudsendelse ?? false, extra.genudsendelseFaktor)
      if (!Number.isFinite(points) || points < 0) throw new Error(`Ugyldige point for kilderækken ${row.id}.`)
      return { row, match, workType, base: calculated.base, tierLabel: calculated.tierLabel, points }
    })

    const components = (policy.distribution_policy_components ?? []) as PolicyComponent[]
    const preview = computePolicyPreview(payload.grossAmountMinor, policy.admin_rate_bps, components)
    if (!preview.invariant_ok) throw new Error("Fordelingspolitikken afstemmer ikke til bruttobeløbet.")
    const expected = payload.expectedPreview
    const expectedSocial = preview.sku_direct + preview.sku_from_reserve + preview.statutory_collective
    if (expected.admin !== preview.admin || expected.claimReserve !== preview.net_claim_reserve
      || expected.social !== expectedSocial || expected.individual !== preview.individual) {
      throw new Error("Prøveberegningen afviger fra den aktive fordelingspolitik. Opdatér forudsætningerne og beregn igen.")
    }

    const weightsForDistribution = weightedRows.map(({ row, points }) => ({ id: row.id, weight: points }))
    const distribute = (amount: number) => new Map(
      allocateByLargestRemainder(amount, weightsForDistribution).map((item) => [item.id, item.amount]),
    )
    const allocated = {
      gross: distribute(preview.gross), admin: distribute(preview.admin),
      claimReserve: distribute(preview.claim_reserve), skuDirect: distribute(preview.sku_direct),
      skuFromReserve: distribute(preview.sku_from_reserve), collective: distribute(preview.statutory_collective),
      netReserve: distribute(preview.net_claim_reserve), individual: distribute(preview.individual),
      poolBps: distribute(10_000),
    }
    const workRows = weightedRows.map(({ row, match, workType, base, tierLabel, points }) => ({
      source_row_id: row.id,
      source_ref: row.rawTitle,
      work_id: match.workId,
      episode_id: match.episodeId ?? null,
      usage_date: row.broadcastDate ?? null,
      usage_year: row.broadcastDate ? Number(row.broadcastDate.slice(0, 4)) : batch.year,
      is_rebroadcast: row.isGenudsendelse ?? false,
      points,
      pool_share_bps: allocated.poolBps.get(row.id),
      gross_share: allocated.gross.get(row.id),
      admin_share: allocated.admin.get(row.id),
      claim_reserve_share: allocated.claimReserve.get(row.id),
      sku_direct_share: allocated.skuDirect.get(row.id),
      sku_from_reserve_share: allocated.skuFromReserve.get(row.id),
      statutory_collective_share: allocated.collective.get(row.id),
      net_claim_reserve_share: allocated.netReserve.get(row.id),
      individual_net: allocated.individual.get(row.id),
      point_snapshot: { workType, duration: row.duration, base, tierLabel },
    }))

    const { data, error } = await db.rpc("create_rights_run_from_aftalelicens", {
      p_org_id: caller.orgId,
      p_batch_id: payload.batchId,
      p_fund_id: payload.fundId,
      p_policy_version_id: payload.policyVersionId,
      p_period_label: `${batch.kilde} ${batch.year}`,
      p_gross_amount: payload.grossAmountMinor,
      p_run_totals: {
        admin_amount: preview.admin, distribution_basis: preview.distribution_basis,
        claim_reserve_amount: preview.claim_reserve, sku_direct_amount: preview.sku_direct,
        sku_from_reserve_amount: preview.sku_from_reserve,
        statutory_collective_amount: preview.statutory_collective,
        net_claim_reserve_amount: preview.net_claim_reserve, individual_amount: preview.individual,
      },
      p_weight_snapshot: { weights, extra, rows: workRows.map((row) => ({ source_row_id: row.source_row_id, ...row.point_snapshot })) },
      p_preview_snapshot: { expected, authoritative: preview },
      p_work_rows: workRows,
      p_prepared_by: caller.userId,
    })
    if (error) throw error
    const result = Array.isArray(data) ? data[0] : data
    if (!result?.run_id) throw new Error("Databasen returnerede ingen rettighedsrunde.")

    revalidatePath(`/admin/aftalelicens/${payload.batchId}`)
    revalidatePath("/admin/rettighedsmidler")
    return { success: true, runId: result.run_id, created: result.created === true }
  } catch (error) {
    console.error("[aftalelicens-rights-transfer] overførsel fejlede:", error)
    return { success: false, error: errorMessage(error, "Kunne ikke overføre beregningen") }
  }
}
