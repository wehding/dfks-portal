<!-- DFKS_AI_RULES_VERSION: 1.0.0 -->
# Shared coding rules for DFKS Portal

This is the canonical, provider-independent coding policy for OpenAI Codex and
Claude Code. Read it before changing code. `AGENTS.md` and `CLAUDE.md` may add
tool-specific guidance, but they must not weaken these controls.

The rules prepare DFKS Portal for stronger audit and compliance evidence. They
do not certify the system or replace legal, DPO, security, or management review.

## Change classification

Classify the change before editing:

- **A — presentation only:** copy, styling, layout, icons, or other changes that
  do not alter data access or behavior. Run focused UI/lint/type checks only.
- **B — ordinary behavior:** application behavior without a new sensitive-data
  flow. Run focused functional tests plus type/build checks in proportion to risk.
- **C — sensitive processing:** reads, searches, writes, downloads, exports,
  OCR, AI, statistics, messages, or background jobs involving member, contract,
  salary, union-membership, contact, or document data. Apply every rule below.
- **D — privileged or structural:** authentication, authorization, RLS, roles,
  migrations, retention, signing keys, storage policies, or production-critical
  infrastructure. Apply C plus rollback, security, and deployment verification.

When uncertain, use the higher classification and explain why in the handoff.

## Sensitive-flow requirements

For every C or D change:

1. Register or update the processing and technical entrypoint in
   `config/audit-coverage.json`.
2. Record one semantic audit event per user action. Database row triggers may
   add technical detail events, but must not replace the semantic event.
3. Attach every affected member through `targetMemberUuids`; never hide member
   UUIDs in free-text metadata.
4. Preserve organization scope, authorization, RLS, and least privilege.
5. Keep raw search text, document content, prompts, AI responses, salary values,
   credentials, and direct contact details out of audit metadata.
6. Fail closed when the mandatory local audit append for a successful sensitive
   response fails. Keep SIEM, KMS, WORM, and deep verification asynchronous.
7. Add or update a focused integration test for authorization, organization
   isolation, audit outcome, member subjects, and relevant failure behavior.

## Performance requirements

- Measure only affected hot paths; A and B changes do not automatically require
  the full performance suite.
- For list/data changes, record first-row time, complete-list time, request count,
  bytes, and P50/P95/P99 where the test environment supports them.
- Treat roughly 100 ms synchronous audit overhead or more than 10% P95 regression
  as a finding that needs remediation or an explicit, documented rationale.
- Avoid per-row audit network calls. Batch subject relations and move external
  delivery, signing, archive writes, and report generation off the request path.
- Prefer query/index review, smaller projections, keyset pagination, consolidated
  counters, caching, region alignment, reduced hydration, and correct image LCP.

## Database and Supabase requirements

- Put schema changes in a Supabase migration created by the CLI.
- Enable RLS on exposed tables and use explicit ownership/organization predicates.
- Never expose service-role credentials or privileged functions to browser roles.
- Revoke `PUBLIC` execution on security-definer functions and grant only the
  required server role. Do not use security definer merely to bypass RLS errors.
- Test create/read/update/delete behavior and run the relevant pgTAP/RLS checks.
- Do not deploy migrations or change production settings without explicit
  operational authorization.

## Required verification

Select commands by classification and affected area. The baseline commands are:

- `npm run agent:rules`
- `npm run audit:coverage`
- `npm run test:audit-lifecycle` for audit schema and semantic-flow changes
- `npm run test:list-performance` for affected list-page or query changes
- `npm run check` and `npm run build` for functional TypeScript application work

Do not claim a command passed unless it was actually run. Record skipped checks
and the reason. Never use production member data as a test fixture.

## Documentation and handoff

- State the classification, affected sensitive flows, tests, measurements, and
  remaining risks in the handoff.
- Keep registry status explicit: `implemented`, `activated`, `verified`, or
  `pending`. Code alone does not prove production activation.
- Material changes feed the existing weekly living-documentation process. Do not
  create a competing documentation cron or duplicate the three main documents.
- Agents may recommend legal or certification work, but may not approve legal
  basis, retention, unmasking, risk acceptance, ISO certification, or compliance.

## Part 1 operating mode

The checks above are reporting controls in part 1. They surface gaps and produce
evidence without adding new PR approval, reviewer, or four-eyes requirements.
Existing repository Git rules remain in force. Formal change governance belongs
to the later part 2 plan.
