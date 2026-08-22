import type { SupabaseClient } from "@supabase/supabase-js"

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 500

type CachedLabel = { label: string; expiresAt: number }
const labels = new Map<string, CachedLabel>()

export async function getAuthUserLabels(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds)].slice(0, 100)
  const now = Date.now()
  const result = new Map<string, string>()
  const missing: string[] = []

  for (const id of uniqueIds) {
    const cached = labels.get(id)
    if (cached && cached.expiresAt > now) result.set(id, cached.label)
    else missing.push(id)
  }

  await Promise.all(missing.map(async id => {
    const { data, error } = await admin.auth.admin.getUserById(id)
    if (error || !data.user) return
    const metadataName = data.user.user_metadata?.full_name
    const label = typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim()
      : data.user.email ?? "Tildelt medarbejder"
    result.set(id, label)
    labels.set(id, { label, expiresAt: now + CACHE_TTL_MS })
  }))

  if (labels.size > MAX_CACHE_ENTRIES) {
    for (const [id, entry] of labels) {
      if (entry.expiresAt <= now || labels.size > MAX_CACHE_ENTRIES) labels.delete(id)
      if (labels.size <= MAX_CACHE_ENTRIES) break
    }
  }

  return result
}
