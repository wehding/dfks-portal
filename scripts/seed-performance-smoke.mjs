import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase testkonfiguration mangler");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const orgId = "10000000-0000-4000-8000-000000000001";
const preferredHolderId = "10000000-0000-4000-8000-000000000002";
const email = "performance@dfks.test";
const password = "Performance-test-2026";

const organisationResult = await db.from("organisations").upsert({
  id: orgId,
  name: "Performance Test Organisation",
  active: true,
  module_contracts: true,
  module_archive: true,
});
if (organisationResult.error) throw organisationResult.error;

const users = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
let user = users.data.users.find(candidate => candidate.email === email) ?? null;
if (!user) {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Performance Admin" } });
  if (created.error) throw created.error;
  user = created.data.user;
} else {
  const updated = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (updated.error) throw updated.error;
}

const statements = [
  db.from("user_org_roles").upsert({ user_id: user.id, org_id: orgId, role: "superadmin" }, { onConflict: "user_id,org_id,role" }),
];
for (const statement of statements) {
  const { error } = await statement;
  if (error) throw error;
}
const existingHolder = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
if (existingHolder.error) throw existingHolder.error;
const holderId = existingHolder.data?.id ?? preferredHolderId;
const memberStatements = [
  db.from("rettighedshavere").upsert({ id: holderId, user_id: user.id, full_name: "Performance Admin", email, onboarding_completed: true }),
  db.from("org_affiliations").upsert({ org_id: orgId, rights_holder_id: holderId, is_member: true, valid_to: null }, { onConflict: "org_id,rights_holder_id" }),
];
for (const statement of memberStatements) {
  const { error } = await statement;
  if (error) throw error;
}

const workRows = Array.from({ length: 400 }, (_, index) => ({
  id: `20000000-0000-4000-8${String(index).padStart(3, "0").slice(0, 3)}-${String(index + 1).padStart(12, "0")}`,
  org_id: orgId,
  title: `Performanceværk ${String(index + 1).padStart(4, "0")}`,
  type: index % 5 === 0 ? "dokumentarfilm" : "spillefilm",
  year: 2000 + (index % 26),
  status: "aktiv",
}));

for (let offset = 0; offset < workRows.length; offset += 100) {
  const works = workRows.slice(offset, offset + 100);
  const workResult = await db.from("works").upsert(works);
  if (workResult.error) throw workResult.error;
  const assignmentResult = await db.from("work_assignments").upsert(works.map((work, index) => ({
    id: `30000000-0000-4000-8${String(offset + index).padStart(3, "0").slice(0, 3)}-${String(offset + index + 1).padStart(12, "0")}`,
    work_id: work.id,
    org_id: orgId,
    rights_holder_id: holderId,
    role: "Klipper",
  })));
  if (assignmentResult.error) throw assignmentResult.error;
  const contractResult = await db.from("contracts").upsert(works.map((work, index) => ({
    id: `40000000-0000-4000-8${String(offset + index).padStart(3, "0").slice(0, 3)}-${String(offset + index + 1).padStart(12, "0")}`,
    org_id: orgId,
    rights_holder_id: holderId,
    work_id: work.id,
    type: "A-løn",
    status: "kladde",
    working_title: work.title,
  })));
  if (contractResult.error) throw contractResult.error;
}

console.info(JSON.stringify({ seeded: true, works: workRows.length, contracts: workRows.length }));
