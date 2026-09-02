-- Contract owner verification is deliberately server-only.  It records the
-- durable provenance which short-lived upload intents cannot provide, and it
-- is the only supported path for changing an established contract owner.

create table public.contract_owner_verifications (
  contract_id uuid primary key references public.contracts(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete restrict,
  assigned_rights_holder_id uuid references public.rettighedshavere(id) on delete restrict,
  proposed_rights_holder_id uuid references public.rettighedshavere(id) on delete restrict,
  status text not null default 'pending' check (status in (
    'pending', 'confirmed', 'conflict', 'correction_proposed', 'corrected', 'blocked', 'not_applicable'
  )),
  assignment_origin text not null default 'unknown' check (assignment_origin in (
    'authenticated_member_upload', 'authenticated_member_drive',
    'admin_selected_at_intake', 'admin_manual', 'gmail_import', 'ai_suggestion',
    'historical_assignment', 'profile_merge', 'unknown'
  )),
  reason_code text check (
    reason_code is null or reason_code ~ '^[a-z0-9_]{1,80}$'
  ),
  match_version text check (
    match_version is null or char_length(match_version) between 1 and 100
  ),
  evidence_subject_rights_holder_id uuid
    references public.rettighedshavere(id) on delete restrict,
  evidence_ai_job_id uuid references public.contract_ai_jobs(id) on delete restrict,
  evidence_document_job_id uuid references public.contract_document_jobs(id) on delete restrict,
  evidence_spatial_sha256 text check (
    evidence_spatial_sha256 is null or evidence_spatial_sha256 ~ '^[0-9a-f]{64}$'
  ),
  evidence_spatial_schema_version text check (
    evidence_spatial_schema_version is null
    or char_length(evidence_spatial_schema_version) between 1 and 100
  ),
  evidence_page integer check (evidence_page is null or evidence_page between 1 and 10000),
  evidence_bbox jsonb check (
    evidence_bbox is null
    or (jsonb_typeof(evidence_bbox) = 'object' and octet_length(evidence_bbox::text) <= 2048)
  ),
  evidence_confidence numeric(5,4) check (
    evidence_confidence is null or evidence_confidence between 0 and 1
  ),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_owner_verifications_review_state_check check (
    (
      status in ('confirmed', 'corrected', 'blocked')
      and reviewed_by is not null
      and reviewed_at is not null
    )
    or status in ('pending', 'conflict', 'correction_proposed', 'not_applicable')
  ),
  constraint contract_owner_verifications_distinct_proposal_check check (
    proposed_rights_holder_id is null
    or proposed_rights_holder_id is distinct from assigned_rights_holder_id
  ),
  constraint contract_owner_verifications_evidence_subject_check check (
    evidence_subject_rights_holder_id is not null
    or (
      evidence_ai_job_id is null
      and evidence_document_job_id is null
      and evidence_spatial_sha256 is null
      and evidence_spatial_schema_version is null
      and evidence_page is null
      and evidence_bbox is null
      and evidence_confidence is null
    )
  )
);

comment on table public.contract_owner_verifications is
  'Server-only current state for manual verification of a contract owner. Names and contract content must not be stored here.';
comment on column public.contract_owner_verifications.assignment_origin is
  'Durable origin of the currently assigned owner; AI suggestions never become ownership without an admin decision.';
comment on column public.contract_owner_verifications.evidence_bbox is
  'Optional geometry only. Never store OCR text, names or other document content in this field.';
comment on column public.contract_owner_verifications.evidence_subject_rights_holder_id is
  'The exact rights holder identified by the immutable AI/document evidence. It may differ from the final owner as counter-evidence.';

create index contract_owner_verifications_org_status_idx
  on public.contract_owner_verifications(org_id, status, updated_at, contract_id);
create index contract_owner_verifications_org_assigned_idx
  on public.contract_owner_verifications(org_id, assigned_rights_holder_id, status)
  where assigned_rights_holder_id is not null;
create index contract_owner_verifications_org_proposed_idx
  on public.contract_owner_verifications(org_id, proposed_rights_holder_id, status)
  where proposed_rights_holder_id is not null;

alter table public.contract_owner_verifications enable row level security;
revoke all on table public.contract_owner_verifications from public, anon, authenticated;
grant select, insert, update, delete on table public.contract_owner_verifications to service_role;

create table public.contract_owner_provenance (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete restrict,
  rights_holder_id uuid references public.rettighedshavere(id) on delete restrict,
  origin text not null check (origin in (
    'authenticated_member_upload', 'authenticated_member_drive',
    'admin_selected_at_intake', 'admin_manual', 'gmail_import', 'ai_suggestion',
    'historical_assignment', 'profile_merge', 'unknown'
  )),
  authenticated_user_id uuid references auth.users(id) on delete set null,
  source_record_type text check (
    source_record_type is null or source_record_type ~ '^[a-z0-9_]{1,60}$'
  ),
  source_record_id uuid,
  evidence_ai_job_id uuid references public.contract_ai_jobs(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint contract_owner_provenance_source_pair_check check (
    (source_record_type is null) = (source_record_id is null)
  )
);

comment on table public.contract_owner_provenance is
  'Immutable server-only provenance for owner assignments and suggestions. It contains identifiers, never names or contract text.';

create unique index contract_owner_provenance_idempotency_idx
  on public.contract_owner_provenance(
    contract_id,
    origin,
    coalesce(source_record_type, ''),
    coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(rights_holder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(evidence_ai_job_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index contract_owner_provenance_contract_recorded_idx
  on public.contract_owner_provenance(contract_id, recorded_at, id);

alter table public.contract_owner_provenance enable row level security;
revoke all on table public.contract_owner_provenance from public, anon, authenticated;
grant select, insert on table public.contract_owner_provenance to service_role;

create or replace function private.guard_contract_owner_provenance_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.contracts where id = old.contract_id
  ) then
    return old;
  end if;
  if coalesce(current_setting('app.contract_owner_change_scope', true), '') <> 'profile_merge' then
    raise exception 'Ejerskabsproveniens er uforanderlig' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_contract_owner_provenance_immutability()
  from public, anon, authenticated;
create trigger guard_contract_owner_provenance_immutability
before update or delete on public.contract_owner_provenance
for each row execute function private.guard_contract_owner_provenance_immutability();

create or replace function private.guard_contract_owner_provenance_relations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.contracts as contract
    where contract.id = new.contract_id
      and contract.org_id = new.org_id
  ) then
    raise exception 'Ejerskabsproveniensen har forkert kontraktorganisation'
      using errcode = '23514';
  end if;

  if new.rights_holder_id is not null
    and new.origin not in ('historical_assignment', 'profile_merge')
    and coalesce(current_setting('app.contract_owner_change_scope', true), '') <> 'profile_merge'
    and not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = new.org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = new.rights_holder_id
        and holder.archived_at is null
    ) then
    raise exception 'Ejerskabsproveniensen peger på en utilgængelig rettighedshaver'
      using errcode = '23514';
  end if;

  if new.evidence_ai_job_id is not null and not exists (
    select 1
    from public.contract_ai_jobs as evidence_job
    where evidence_job.id = new.evidence_ai_job_id
      and evidence_job.contract_id = new.contract_id
      and evidence_job.org_id = new.org_id
      and evidence_job.attachment_id is null
      and evidence_job.superseded_by_job_id is null
  ) then
    raise exception 'AI-kilden til ejerskabsproveniensen matcher ikke kontrakten'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_contract_owner_provenance_relations()
  from public, anon, authenticated;
create trigger guard_contract_owner_provenance_relations
before insert or update on public.contract_owner_provenance
for each row execute function private.guard_contract_owner_provenance_relations();

-- Existing contracts have no durable assignment provenance.  They therefore
-- enter the queue as pending instead of being treated as implicitly verified.
insert into public.contract_owner_verifications (
  contract_id, org_id, assigned_rights_holder_id, status, assignment_origin
)
select contract.id, contract.org_id, contract.rights_holder_id, 'pending', 'historical_assignment'
from public.contracts as contract
on conflict (contract_id) do nothing;

insert into public.contract_owner_provenance (
  contract_id, org_id, rights_holder_id, origin
)
select contract.id, contract.org_id, contract.rights_holder_id, 'historical_assignment'
from public.contracts as contract
where contract.rights_holder_id is not null
on conflict do nothing;

-- Service-role is not a substitute for relational validation.  This trigger
-- also protects AI-candidate upserts performed by server workers.
create or replace function private.guard_contract_owner_verification_relations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  candidate_id uuid;
begin
  if not exists (
    select 1 from public.contracts as contract
    where contract.id = new.contract_id and contract.org_id = new.org_id
  ) then
    raise exception 'Ejerskabskontrollen har forkert kontraktorganisation'
      using errcode = '23514';
  end if;

  candidate_id := new.proposed_rights_holder_id;
  if candidate_id is not null
    and new.assignment_origin <> 'profile_merge'
    and coalesce(current_setting('app.contract_owner_change_scope', true), '') <> 'profile_merge'
    and not exists (
    select 1
    from public.rettighedshavere as holder
    join public.org_affiliations as affiliation
      on affiliation.rights_holder_id = holder.id
    where affiliation.org_id = new.org_id
      and holder.id = candidate_id
      and holder.archived_at is null
      and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
      and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
  ) then
    raise exception 'Rettighedshaveren har ingen aktiv tilknytning til organisationen'
      using errcode = '23514';
  end if;

  candidate_id := new.assigned_rights_holder_id;
  if candidate_id is not null
     and new.status <> 'blocked'
     and new.assignment_origin not in ('historical_assignment', 'profile_merge')
     and coalesce(current_setting('app.contract_owner_change_scope', true), '') <> 'profile_merge'
     and not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
      where affiliation.org_id = new.org_id
        and holder.id = candidate_id
        and holder.archived_at is null
        and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
        and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
    ) then
    raise exception 'Rettighedshaveren har ingen aktiv tilknytning til organisationen'
      using errcode = '23514';
  end if;

  candidate_id := new.evidence_subject_rights_holder_id;
  if candidate_id is not null
    and new.assignment_origin not in ('historical_assignment', 'profile_merge')
    and coalesce(current_setting('app.contract_owner_change_scope', true), '') <> 'profile_merge'
    and not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = new.org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = candidate_id
        and holder.archived_at is null
    ) then
    raise exception 'Evidensens rettighedshaver har ingen aktiv tilknytning til organisationen'
      using errcode = '23514';
  end if;

  if new.evidence_ai_job_id is not null and not exists (
    select 1 from public.contract_ai_jobs as evidence_job
    where evidence_job.id = new.evidence_ai_job_id
      and evidence_job.contract_id = new.contract_id
      and evidence_job.org_id = new.org_id
      and evidence_job.attachment_id is null
      and evidence_job.superseded_by_job_id is null
  ) then
    raise exception 'AI-kilden tilhører ikke den aktuelle kontrakt'
      using errcode = '23514';
  end if;

  if new.evidence_document_job_id is not null and not exists (
    select 1 from public.contract_document_jobs as evidence_job
    where evidence_job.id = new.evidence_document_job_id
      and evidence_job.contract_id = new.contract_id
      and evidence_job.org_id = new.org_id
      and evidence_job.status = 'completed'
      and evidence_job.superseded_by_job_id is null
  ) then
    raise exception 'Dokumentkilden tilhører ikke den aktuelle kontrakt'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_contract_owner_verification_relations()
  from public, anon, authenticated;

drop trigger if exists guard_contract_owner_verification_relations
  on public.contract_owner_verifications;
create trigger guard_contract_owner_verification_relations
before insert or update on public.contract_owner_verifications
for each row execute function private.guard_contract_owner_verification_relations();

-- Future inserts start pending. Session-bound member paths promote them only
-- from the validated upload/Drive RPC, where durable source provenance exists.
-- Direct browser inserts may never assign another member. Managers and
-- jurists can insert an ownerless draft; a member can only insert a draft
-- bound to their own active profile. Server-side intake uses service_role and
-- records the stronger source through record_contract_owner_provenance().
drop policy if exists "Brugere og orgadmins kan oprette kontrakter" on public.contracts;
create policy "Brugere og reviewstaff kan oprette sikre kontraktkladder"
on public.contracts
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (
      rights_holder_id is null
      and public.current_user_can_review_org(org_id)
    )
    or (
      rights_holder_id is not null
      and not public.current_user_can_review_org(org_id)
      and public.current_user_is_member_owner(rights_holder_id)
      and exists (
        select 1
        from public.rettighedshavere as holder
        join public.org_affiliations as affiliation
          on affiliation.rights_holder_id = holder.id
         and affiliation.org_id = contracts.org_id
         and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
         and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
        where holder.id = contracts.rights_holder_id
          and holder.user_id = (select auth.uid())
          and holder.archived_at is null
      )
    )
  )
);

create or replace function private.seed_contract_owner_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.contract_owner_verifications (
    contract_id, org_id, assigned_rights_holder_id, status, assignment_origin
  ) values (
    new.id, new.org_id, new.rights_holder_id, 'pending', 'unknown'
  )
  on conflict (contract_id) do nothing;
  if new.rights_holder_id is not null then
    insert into public.contract_owner_provenance (
      contract_id, org_id, rights_holder_id, origin
    ) values (
      new.id, new.org_id, new.rights_holder_id, 'unknown'
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.seed_contract_owner_verification() from public, anon, authenticated;

drop trigger if exists seed_contract_owner_verification on public.contracts;
create trigger seed_contract_owner_verification
after insert on public.contracts
for each row execute function private.seed_contract_owner_verification();

-- A contract comment belongs to the member who participated when the comment
-- was created. Reassigning the contract must never transfer that conversation
-- to the replacement owner.
alter table public.contract_comments
  add column member_rights_holder_id uuid
  references public.rettighedshavere(id) on delete set null;

-- Historical data is deliberately backfilled fail-closed. The contract's
-- current owner is not evidence of who participated when an older message was
-- written, because ownership could previously be edited without provenance.
-- A member-authored comment is bound only when its auth user resolves to one
-- unambiguous rights-holder profile in the comment's organisation.
-- An admin reply is bound only when the existing notification ledger records
-- its exact intended recipient. Missing/ambiguous historical replies remain
-- NULL and therefore staff-only until manually clarified; they are never
-- exposed to the contract's current owner by assumption.
create or replace function private.backfill_contract_comment_participants()
returns void
language plpgsql
set search_path = ''
as $$
begin
  with resolved_member_comments as (
    select comment.id as comment_id,
           (array_agg(distinct holder.id order by holder.id))[1] as rights_holder_id
    from public.contract_comments as comment
    join public.rettighedshavere as holder
      on holder.user_id = comment.author_user_id
    join public.org_affiliations as affiliation
      on affiliation.rights_holder_id = holder.id
     and affiliation.org_id = comment.org_id
    where comment.author_role = 'member'
      and comment.member_rights_holder_id is null
    group by comment.id
    having count(distinct holder.id) = 1
  )
  update public.contract_comments as comment
  set member_rights_holder_id = resolved.rights_holder_id
  from resolved_member_comments as resolved
  where comment.id = resolved.comment_id;

  update public.contract_comments as comment
  set member_rights_holder_id = delivery.rights_holder_id
  from public.notification_deliveries as delivery
  where comment.author_role = 'admin'
    and comment.member_rights_holder_id is null
    and delivery.org_id = comment.org_id
    and delivery.event_key = 'contract-comment:' || comment.id::text
    and delivery.entity_type = 'contract'
    and delivery.entity_id = comment.contract_id;
end;
$$;

revoke all on function private.backfill_contract_comment_participants()
  from public, anon, authenticated, service_role;

select private.backfill_contract_comment_participants();

comment on column public.contract_comments.member_rights_holder_id is
  'Stable participant binding captured at creation or proven by historical identity/notification evidence; NULL historical rows remain staff-only.';

create index contract_comments_member_holder_unread_idx
  on public.contract_comments(member_rights_holder_id, author_role, member_read_at, created_at desc)
  where member_rights_holder_id is not null;

create or replace function private.bind_contract_comment_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_org_id uuid;
  contract_rights_holder_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.contract_id is distinct from old.contract_id
      or new.org_id is distinct from old.org_id
      or new.member_rights_holder_id is distinct from old.member_rights_holder_id then
      if new.contract_id is distinct from old.contract_id
        or new.org_id is distinct from old.org_id
        or not (
          (
            old.member_rights_holder_id is not null
            and new.member_rights_holder_id is null
            and not exists (
              select 1 from public.rettighedshavere as holder
              where holder.id = old.member_rights_holder_id
            )
          )
          or (
            old.member_rights_holder_id is null
            and new.member_rights_holder_id is not null
            and (
              coalesce(current_setting('app.contract_owner_change_scope', true), '') = 'profile_merge'
              or exists (
                select 1
                from public.contracts as contract
                where contract.id = new.contract_id
                  and contract.org_id = new.org_id
                  and contract.rights_holder_id = new.member_rights_holder_id
              )
            )
          )
        ) then
        raise exception 'En kontraktkommentars deltagerbinding kan ikke ændres'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  select contract.org_id, contract.rights_holder_id
  into contract_org_id, contract_rights_holder_id
  from public.contracts as contract
  where contract.id = new.contract_id;

  if contract_org_id is null or contract_org_id <> new.org_id then
    raise exception 'Kontraktkommentaren har forkert kontraktorganisation'
      using errcode = '23514';
  end if;
  if new.member_rights_holder_id is not null
    and new.member_rights_holder_id is distinct from contract_rights_holder_id then
    raise exception 'Kontraktkommentarens deltager kan ikke vælges af klienten'
      using errcode = '42501';
  end if;

  new.member_rights_holder_id := contract_rights_holder_id;
  return new;
end;
$$;

revoke all on function private.bind_contract_comment_participant()
  from public, anon, authenticated;

drop trigger if exists bind_contract_comment_participant on public.contract_comments;
create trigger bind_contract_comment_participant
before insert or update of contract_id, org_id, member_rights_holder_id
on public.contract_comments
for each row execute function private.bind_contract_comment_participant();

drop policy if exists "Brugere og admins kan se kontraktkommentarer"
  on public.contract_comments;
create policy "Deltagere og reviewstaff kan se kontraktkommentarer"
on public.contract_comments
for select
to authenticated
using (
  (
    member_rights_holder_id is not null
    and public.current_user_is_member_owner(member_rights_holder_id)
  )
  or public.current_user_can_review_org(org_id)
);

create or replace function public.record_contract_owner_provenance(
  p_contract_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_origin text,
  p_authenticated_user_id uuid,
  p_source_record_type text,
  p_source_record_id uuid,
  p_evidence_ai_job_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_contract public.contracts%rowtype;
  locked_verification public.contract_owner_verifications%rowtype;
  provenance_id uuid;
  owner_was_unassigned boolean := false;
begin
  if p_contract_id is null or p_org_id is null or p_rights_holder_id is null
    or p_origin not in (
      'authenticated_member_upload', 'authenticated_member_drive',
      'admin_selected_at_intake', 'admin_manual', 'gmail_import', 'unknown'
    )
    or p_source_record_type is null
    or p_source_record_type !~ '^[a-z0-9_]{1,60}$'
    or p_source_record_id is null then
    raise exception 'Ugyldig ejerskabsproveniens' using errcode = '22023';
  end if;

  select * into locked_contract
  from public.contracts
  where id = p_contract_id and org_id = p_org_id
  for update;
  if locked_contract.id is null
    or (
      locked_contract.rights_holder_id is not null
      and locked_contract.rights_holder_id is distinct from p_rights_holder_id
    ) then
    raise exception 'Proveniens matcher ikke kontraktens ejer' using errcode = '42501';
  end if;
  owner_was_unassigned := locked_contract.rights_holder_id is null;
  if owner_was_unassigned and (
    p_origin not in (
      'authenticated_member_upload', 'authenticated_member_drive',
      'admin_selected_at_intake', 'admin_manual'
    )
    or p_source_record_type <> 'contract_import_batch'
  ) then
    raise exception 'En ejerløs kontrakt kan kun tildeles fra en verificeret importbatch'
      using errcode = '42501';
  end if;

  select * into locked_verification
  from public.contract_owner_verifications
  where contract_id = p_contract_id and org_id = p_org_id
  for update;
  if locked_verification.contract_id is null
    or (
      locked_verification.assigned_rights_holder_id is not null
      and locked_verification.assigned_rights_holder_id is distinct from p_rights_holder_id
    )
    or owner_was_unassigned <> (locked_verification.assigned_rights_holder_id is null) then
    raise exception 'Proveniens matcher ikke ejerskabskontrollen' using errcode = '42501';
  end if;

  if p_origin in ('authenticated_member_upload', 'authenticated_member_drive') then
    if p_authenticated_user_id is null or not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = p_org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = p_rights_holder_id
        and holder.user_id = p_authenticated_user_id
        and holder.archived_at is null
    ) then
      raise exception 'Den sessionbundne medlemsidentitet kunne ikke verificeres'
        using errcode = '42501';
    end if;
  elsif p_origin in ('admin_selected_at_intake', 'admin_manual') then
    if p_authenticated_user_id is null or not exists (
      select 1 from public.user_org_roles as actor_role
      where actor_role.user_id = p_authenticated_user_id
        and actor_role.role in ('superadmin', 'admin', 'org-admin')
        and (actor_role.role = 'superadmin' or actor_role.org_id = p_org_id)
    ) then
      raise exception 'Administratoridentiteten kunne ikke verificeres' using errcode = '42501';
    end if;
  end if;

  if p_source_record_type = 'contract_import_batch' and not exists (
    select 1
    from public.contract_import_batches as batch
    where batch.id = p_source_record_id
      and batch.org_id = p_org_id
      and batch.created_by = p_authenticated_user_id
      and batch.status <> 'cancelled'
  ) then
    raise exception 'Importbatchen matcher ikke ejerens autentificerede kilde'
      using errcode = '42501';
  end if;

  if p_evidence_ai_job_id is not null and not exists (
    select 1 from public.contract_ai_jobs as ai_job
    where ai_job.id = p_evidence_ai_job_id
      and ai_job.contract_id = p_contract_id
      and ai_job.org_id = p_org_id
      and ai_job.attachment_id is null
      and ai_job.superseded_by_job_id is null
  ) then
    raise exception 'AI-kilden matcher ikke kontrakten' using errcode = '22023';
  end if;

  -- Secondary admin/Drive intake creates the contract ownerless. Assign the
  -- owner only here, after the durable actor, organisation and source checks
  -- have passed. Verification state is changed before the contract so the
  -- consistency trigger observes one atomic state transition. Any later error
  -- in this function rolls both writes back with the provenance insert.
  if owner_was_unassigned then
    perform set_config('app.contract_owner_change_scope', p_contract_id::text, true);
    update public.contract_owner_verifications
    set assigned_rights_holder_id = p_rights_holder_id,
        proposed_rights_holder_id = null,
        status = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then 'confirmed'
          else 'pending'
        end,
        assignment_origin = p_origin,
        reason_code = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then 'session_bound_owner'
          else null
        end,
        reviewed_by = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then p_authenticated_user_id
          else null
        end,
        reviewed_at = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then now()
          else null
        end,
        revision = revision + 1,
        updated_at = now()
    where contract_id = p_contract_id and org_id = p_org_id;

    update public.contracts
    set rights_holder_id = p_rights_holder_id
    where id = p_contract_id and org_id = p_org_id;
  end if;

  insert into public.contract_owner_provenance (
    contract_id, org_id, rights_holder_id, origin, authenticated_user_id,
    source_record_type, source_record_id, evidence_ai_job_id
  ) values (
    p_contract_id, p_org_id, p_rights_holder_id, p_origin,
    p_authenticated_user_id, p_source_record_type, p_source_record_id,
    p_evidence_ai_job_id
  )
  on conflict do nothing
  returning id into provenance_id;

  if provenance_id is not null then
    update public.contract_owner_verifications
    set status = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then 'confirmed'
          else status
        end,
        assignment_origin = p_origin,
        reason_code = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then 'session_bound_owner'
          else reason_code
        end,
        reviewed_by = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then p_authenticated_user_id
          else reviewed_by
        end,
        reviewed_at = case
          when p_origin in ('authenticated_member_upload', 'authenticated_member_drive')
            then now()
          else reviewed_at
        end,
        revision = revision + 1,
        updated_at = now()
    where contract_id = p_contract_id and org_id = p_org_id;
  end if;

  select * into locked_verification
  from public.contract_owner_verifications
  where contract_id = p_contract_id;
  return jsonb_build_object(
    'contractId', p_contract_id,
    'status', locked_verification.status,
    'assignmentOrigin', locked_verification.assignment_origin,
    'revision', locked_verification.revision,
    'provenanceId', provenance_id
  );
end;
$$;

revoke all on function public.record_contract_owner_provenance(
  uuid, uuid, uuid, text, uuid, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.record_contract_owner_provenance(
  uuid, uuid, uuid, text, uuid, text, uuid, uuid
) to service_role;

-- A contract owner is not an ordinary editable column.  A transaction-local
-- scope is set only by the dedicated decision RPC or by the verified profile
-- merge RPC below.  Direct Data API updates, including jurist updates, fail.
create or replace function private.guard_contract_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed_scope text := coalesce(current_setting('app.contract_owner_change_scope', true), '');
begin
  if old.rights_holder_id is distinct from new.rights_holder_id
     and allowed_scope not in (old.id::text, 'profile_merge') then
    raise exception 'Kontraktens rettighedshaver skal ændres gennem ejerskabskontrollen'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_contract_owner_change() from public, anon, authenticated;

drop trigger if exists guard_contract_owner_change on public.contracts;
create trigger guard_contract_owner_change
before update of rights_holder_id on public.contracts
for each row execute function private.guard_contract_owner_change();

-- The controlled path updates the verification state first.  This second
-- trigger catches implementation mistakes where the contract and its durable
-- current-state record would otherwise diverge.
create or replace function private.ensure_contract_owner_verification_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.contract_owner_verifications as verification
    where verification.contract_id = new.id
      and verification.org_id = new.org_id
      and verification.assigned_rights_holder_id is not distinct from new.rights_holder_id
  ) then
    raise exception 'Kontraktens ejer og ejerskabskontrol er ikke synkroniseret'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.ensure_contract_owner_verification_consistency() from public, anon, authenticated;

drop trigger if exists ensure_contract_owner_verification_consistency on public.contracts;
create trigger ensure_contract_owner_verification_consistency
after update of rights_holder_id, org_id on public.contracts
for each row
when (
  old.rights_holder_id is distinct from new.rights_holder_id
  or old.org_id is distinct from new.org_id
)
execute function private.ensure_contract_owner_verification_consistency();

create or replace function public.review_contract_owner(
  p_contract_id uuid,
  p_expected_rights_holder_id uuid,
  p_expected_revision bigint,
  p_decision text,
  p_new_rights_holder_id uuid,
  p_reason_code text,
  p_actor_user_id uuid,
  p_actor_org_id uuid,
  p_actor_role text,
  p_evidence_document_job_id uuid default null,
  p_evidence_page integer default null,
  p_evidence_bbox jsonb default null,
  p_evidence_confidence numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_contract public.contracts%rowtype;
  locked_verification public.contract_owner_verifications%rowtype;
  selected_evidence_job public.contract_document_jobs%rowtype;
  new_owner_id uuid;
  next_proposed_owner_id uuid;
  next_status text;
  next_origin text;
  audit_id uuid;
  audit_subjects uuid[];
  decision_evidence_bound boolean := false;
begin
  if p_actor_role = 'jurist' then
    raise exception 'Jurister har ikke adgang til ejerskabskontrollen'
      using errcode = '42501';
  end if;
  if p_contract_id is null
    or p_expected_revision is null or p_expected_revision < 1
    or p_decision not in ('confirm', 'reassign', 'blocked')
    or p_actor_user_id is null or p_actor_org_id is null
    or p_actor_role not in ('superadmin', 'admin', 'org-admin')
    or (p_reason_code is not null and p_reason_code !~ '^[a-z0-9_]{1,80}$')
    or (p_evidence_page is not null and p_evidence_page not between 1 and 10000)
    or (p_evidence_bbox is not null and (
      jsonb_typeof(p_evidence_bbox) <> 'object' or octet_length(p_evidence_bbox::text) > 2048
    ))
    or (p_evidence_confidence is not null and p_evidence_confidence not between 0 and 1) then
    raise exception 'Ugyldig ejerskabsbeslutning' using errcode = '22023';
  end if;

  if (
    p_decision = 'confirm'
    and (
      p_reason_code is null or p_reason_code not in (
        'admin_verified_existing_owner',
        'bulk_confirmed_existing_owner',
        'manual_identity_check'
      )
    )
  ) or (
    p_decision = 'reassign'
    and (
      p_reason_code is null
      or p_reason_code not in ('admin_verified_correction', 'wrong_owner')
    )
  ) or (
    p_decision = 'blocked'
    and (
      p_reason_code is null or p_reason_code not in (
        'manual_review_required',
        'missing_evidence',
        'evidence_conflict',
        'inactive_profile',
        'wrong_organization'
      )
    )
  ) then
    raise exception 'Begrundelseskoden passer ikke til ejerskabsbeslutningen'
      using errcode = '22023';
  end if;

  select * into locked_contract
  from public.contracts
  where id = p_contract_id
  for update;
  if locked_contract.id is null then
    raise exception 'Kontrakten findes ikke' using errcode = 'P0002';
  end if;
  if locked_contract.org_id <> p_actor_org_id then
    raise exception 'Kontrakten tilhører en anden organisation' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.user_org_roles as actor_role
    where actor_role.user_id = p_actor_user_id
      and actor_role.role = p_actor_role
      and actor_role.role in ('superadmin', 'admin', 'org-admin')
      and (actor_role.role = 'superadmin' or actor_role.org_id = locked_contract.org_id)
  ) then
    raise exception 'Administratorrollen kunne ikke verificeres' using errcode = '42501';
  end if;

  select * into locked_verification
  from public.contract_owner_verifications
  where contract_id = locked_contract.id
  for update;
  if locked_verification.contract_id is null
    or locked_verification.org_id <> locked_contract.org_id then
    raise exception 'Ejerskabskontrollen mangler eller har forkert organisation' using errcode = 'P0002';
  end if;
  if locked_contract.rights_holder_id is distinct from p_expected_rights_holder_id
    or locked_verification.assigned_rights_holder_id is distinct from locked_contract.rights_holder_id
    or locked_verification.revision <> p_expected_revision then
    raise exception 'Ejerskabet er ændret siden siden blev indlæst' using errcode = '40001';
  end if;

  if p_evidence_document_job_id is not null then
    if p_decision = 'blocked' then
      raise exception 'En blokeret kontrol kan ikke bindes til positiv dokumentevidens'
        using errcode = '22023';
    end if;
    if locked_verification.evidence_document_job_id is null
      or p_evidence_document_job_id <> locked_verification.evidence_document_job_id then
      raise exception 'Dokumentkilden er ikke den kilde, som ejerskabsforslaget blev bundet til'
        using errcode = '22023';
    end if;
    select * into selected_evidence_job
    from public.contract_document_jobs as evidence_job
    where evidence_job.id = p_evidence_document_job_id
      and evidence_job.contract_id = locked_contract.id
      and evidence_job.org_id = locked_contract.org_id
      and evidence_job.status = 'completed'
      and evidence_job.superseded_by_job_id is null;
    if selected_evidence_job.id is null then
      raise exception 'Dokumentkilden tilhører ikke den aktuelle kontrakt' using errcode = '22023';
    end if;
    if selected_evidence_job.spatial_sha256 is distinct from locked_verification.evidence_spatial_sha256
      or selected_evidence_job.spatial_schema_version is distinct from locked_verification.evidence_spatial_schema_version then
      raise exception 'Dokumentkildens geometriske evidens er ændret'
        using errcode = '40001';
    end if;
  elsif p_evidence_page is not null or p_evidence_bbox is not null
    or p_evidence_confidence is not null then
    raise exception 'Geometrisk evidens kræver den bundne dokumentkilde'
      using errcode = '22023';
  end if;

  if p_decision = 'confirm' then
    if locked_contract.rights_holder_id is null
      or (p_new_rights_holder_id is not null and p_new_rights_holder_id <> locked_contract.rights_holder_id) then
      raise exception 'En tom eller anden rettighedshaver kan ikke bekræftes' using errcode = '22023';
    end if;
    new_owner_id := locked_contract.rights_holder_id;
    next_status := 'confirmed';
    next_origin := locked_verification.assignment_origin;
    next_proposed_owner_id := null;
  elsif p_decision = 'reassign' then
    if p_new_rights_holder_id is null
      or p_new_rights_holder_id is not distinct from locked_contract.rights_holder_id
      or p_reason_code is null then
      raise exception 'Vælg en ny rettighedshaver og en begrundelseskode' using errcode = '22023';
    end if;
    new_owner_id := p_new_rights_holder_id;
    next_status := 'corrected';
    next_origin := 'admin_manual';
    next_proposed_owner_id := null;
  else
    if p_reason_code is null then
      raise exception 'En blokeret kontrol kræver en begrundelseskode' using errcode = '22023';
    end if;
    new_owner_id := locked_contract.rights_holder_id;
    next_status := 'blocked';
    next_origin := locked_verification.assignment_origin;
    next_proposed_owner_id := case
      when p_new_rights_holder_id is not null
        and p_new_rights_holder_id is distinct from locked_contract.rights_holder_id
        then p_new_rights_holder_id
      when locked_verification.proposed_rights_holder_id is not null
        and exists (
          select 1
          from public.rettighedshavere as holder
          join public.org_affiliations as affiliation
            on affiliation.rights_holder_id = holder.id
           and affiliation.org_id = locked_contract.org_id
           and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
           and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
          where holder.id = locked_verification.proposed_rights_holder_id
            and holder.archived_at is null
        ) then locked_verification.proposed_rights_holder_id
      else null
    end;
  end if;

  -- Raw AI/document evidence remains an immutable suggestion even when an
  -- administrator reaches another conclusion. Decision geometry is accepted
  -- only when that evidence explicitly identifies the decision target.
  decision_evidence_bound :=
    p_decision in ('confirm', 'reassign')
    and p_evidence_document_job_id is not null
    and locked_verification.evidence_subject_rights_holder_id = new_owner_id;

  -- A blocked case may retain an inactive historical current owner, but every
  -- proposed replacement still has to be an active member of this exact org.
  if next_proposed_owner_id is not null and not exists (
    select 1
    from public.rettighedshavere as holder
    join public.org_affiliations as affiliation
      on affiliation.rights_holder_id = holder.id
    where affiliation.org_id = locked_contract.org_id
      and holder.id = next_proposed_owner_id
      and holder.archived_at is null
      and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
      and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
  ) then
    raise exception 'Rettighedshaveren har ingen aktiv tilknytning til organisationen'
      using errcode = '42501';
  end if;

  if p_decision <> 'blocked' and new_owner_id is not null and not exists (
    select 1
    from public.rettighedshavere as holder
    join public.org_affiliations as affiliation
      on affiliation.rights_holder_id = holder.id
    where affiliation.org_id = locked_contract.org_id
      and holder.id = new_owner_id
      and holder.archived_at is null
      and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
      and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
  ) then
    raise exception 'Rettighedshaveren har ingen aktiv tilknytning til organisationen'
      using errcode = '42501';
  end if;

  update public.contract_owner_verifications
  set assigned_rights_holder_id = new_owner_id,
      proposed_rights_holder_id = next_proposed_owner_id,
      status = next_status,
      assignment_origin = next_origin,
      reason_code = p_reason_code,
      evidence_page = case when decision_evidence_bound then p_evidence_page else null end,
      evidence_bbox = case when decision_evidence_bound then p_evidence_bbox else null end,
      evidence_confidence = case when decision_evidence_bound then p_evidence_confidence else null end,
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      revision = revision + 1,
      updated_at = now()
  where contract_id = locked_contract.id;

  if p_decision = 'reassign' then
    perform set_config('app.contract_owner_change_scope', locked_contract.id::text, true);
    update public.contracts
    set rights_holder_id = new_owner_id,
        status = case when status = 'valideret' then 'kladde' else status end,
        -- Episode choices belong to the member who confirmed them. Keep the
        -- historical scope row, but never transfer its pointer or selections
        -- to the replacement owner.
        episode_scope_id = null,
        episode_numbers = null
    where id = locked_contract.id and org_id = locked_contract.org_id;

    update public.contract_episode_confirmations
    set invalidated_at = coalesce(invalidated_at, now())
    where contract_id = locked_contract.id and invalidated_at is null;

    update public.contract_validations
    set validated_by = null, validated_at = null
    where contract_id = locked_contract.id;

    -- Import items can outlive the worker state that preceded this decision.
    -- Recompute only resolved workflow states in this same transaction; never
    -- overwrite duplicate, retry, error, blocked, dead or cancelled states. A
    -- series needs a fresh, owner-bound episode confirmation because the
    -- previous owner's scope was invalidated above. Legacy completed items are
    -- reopened deliberately when the new owner still has work to do.
    update public.contract_import_items as import_item
    set status = case
          when locked_contract.work_id is null then 'missing_work'
          when exists (
            select 1
            from public.works as linked_work
            where linked_work.id = locked_contract.work_id
              and (
                linked_work.parent_work_id is not null
                or lower(coalesce(linked_work.type, '')) like '%serie%'
              )
          ) then 'awaiting_episode_confirmation'
          else 'ready_for_review'
        end,
        error_code = null,
        error_message = null,
        updated_at = now()
    where import_item.contract_id = locked_contract.id
      and import_item.org_id = locked_contract.org_id
      and import_item.status in (
        'missing_owner',
        'missing_work',
        'awaiting_episode_confirmation',
        'ready_for_review',
        'completed'
      );
  end if;

  select coalesce(array_agg(distinct member_id order by member_id), '{}'::uuid[])
  into audit_subjects
  from unnest(array[
    locked_contract.rights_holder_id,
    new_owner_id,
    next_proposed_owner_id
  ]) as member_id
  where member_id is not null;

  audit_id := public.append_audit_event_v2(
    p_action => case when p_decision = 'confirm' then 'validate' else 'update' end,
    p_entity_type => 'contract_owner_verification',
    p_entity_id => locked_contract.id::text,
    p_actor_user_id => p_actor_user_id,
    p_actor_role => p_actor_role,
    p_actor_type => 'user',
    p_actor_org_id => locked_contract.org_id,
    p_source => 'admin',
    p_target_member_uuid => coalesce(new_owner_id, locked_contract.rights_holder_id),
    p_target_member_uuids => audit_subjects,
    p_purpose_code => 'contract_case_management',
    p_legal_basis => 'GDPR Art. 6(1)(c)/(f), Art. 9(2)(d)',
    p_data_categories => array['identity_data', 'contract_data', 'union_membership_data'],
    p_system_component => 'admin.contract-owner-verification',
    p_org_ids => array[locked_contract.org_id],
    p_metadata => jsonb_build_object(
      'decision', p_decision,
      'reason_code', p_reason_code,
      'owner_changed', p_decision = 'reassign',
      'verification_revision', locked_verification.revision + 1,
      'evidence_job_bound', decision_evidence_bound
    )
  );
  if audit_id is null then
    raise exception 'Auditregistrering fejlede';
  end if;

  if p_decision = 'reassign' then
    insert into public.contract_owner_provenance (
      contract_id, org_id, rights_holder_id, origin, authenticated_user_id,
      source_record_type, source_record_id
    ) values (
      locked_contract.id, locked_contract.org_id, new_owner_id, 'admin_manual',
      p_actor_user_id, 'audit_event', audit_id
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'contractId', locked_contract.id,
    'status', next_status,
    'rightsHolderId', new_owner_id,
    'revision', locked_verification.revision + 1,
    'auditEventId', audit_id
  );
end;
$$;

revoke all on function public.review_contract_owner(
  uuid, uuid, bigint, text, uuid, text, uuid, uuid, text, uuid, integer, jsonb, numeric
) from public, anon, authenticated;
grant execute on function public.review_contract_owner(
  uuid, uuid, bigint, text, uuid, text, uuid, uuid, text, uuid, integer, jsonb, numeric
) to service_role;

-- Validation may update validation fields but never ownership.  The retained
-- owner parameter keeps old deployments compatible while rejecting a change.
create or replace function public.admin_validate_contract(
  p_contract_id uuid,
  p_status text,
  p_employer_id uuid default null,
  p_type text default null,
  p_overenskomst text default null,
  p_rights_holder_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_contract public.contracts%rowtype;
begin
  select * into locked_contract
  from public.contracts
  where id = p_contract_id
  for update;
  if locked_contract.id is null then
    raise exception 'Kontrakten findes ikke' using errcode = 'P0002';
  end if;
  if p_rights_holder_id is not null
     and p_rights_holder_id is distinct from locked_contract.rights_holder_id then
    raise exception 'Rettighedshaveren skal ændres gennem ejerskabskontrollen'
      using errcode = '42501';
  end if;

  perform set_config('app.explicit_contract_validation', 'on', true);
  update public.contracts
  set status = p_status,
      employer_id = coalesce(p_employer_id, employer_id),
      type = coalesce(p_type, type),
      overenskomst = case when p_overenskomst is not null then p_overenskomst else overenskomst end
  where id = locked_contract.id;
end;
$$;

revoke all on function public.admin_validate_contract(uuid, text, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_validate_contract(uuid, text, uuid, text, text, uuid)
  to service_role;

-- AI extraction may suggest an owner, but it may no longer establish legal
-- ownership.  The suggestion is stored for the manual queue, while series
-- scopes use only the already assigned owner.
create or replace function public.apply_contract_ai_extraction_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fenced public.contract_ai_jobs;
  extracted jsonb := coalesce(p_payload -> 'extractedData', '{}'::jsonb);
  validation_data jsonb := coalesce(p_payload -> 'validation', '{}'::jsonb);
  contract_data jsonb := coalesce(p_payload -> 'contract', '{}'::jsonb);
  import_data jsonb := coalesce(p_payload -> 'import', '{}'::jsonb);
  series_data jsonb := p_payload -> 'series';
  selected_work_id uuid;
  selected_holder_id uuid;
  authoritative_holder_id uuid;
  source_document_job public.contract_document_jobs%rowtype;
  locked_contract public.contracts%rowtype;
  selected_employer_id uuid;
  selected_series_id uuid;
  selected_scope public.member_series_episode_scopes;
  selected_season integer;
  actual_item_status text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(extracted) <> 'object'
    or jsonb_typeof(validation_data) <> 'object'
    or jsonb_typeof(contract_data) <> 'object'
    or jsonb_typeof(import_data) <> 'object' then
    raise exception 'invalid extraction payload' using errcode = '22023';
  end if;

  fenced := public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  if fenced.attachment_id is not null then
    raise exception 'attachment job cannot mutate the base contract' using errcode = '22023';
  end if;

  -- The owner decision RPC serialises on the contract row.  Take the same lock
  -- before deriving the authoritative owner so an AI generation that started
  -- before a manual correction cannot apply stale owner evidence afterwards.
  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = fenced.contract_id and contract.org_id = fenced.org_id
  for update;
  if locked_contract.id is null then
    raise exception 'contract disappeared during fenced apply' using errcode = 'P0002';
  end if;
  authoritative_holder_id := locked_contract.rights_holder_id;

  selected_work_id := case when coalesce(contract_data ->> 'workId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (contract_data ->> 'workId')::uuid else null end;
  selected_holder_id := case
    when coalesce(nullif(contract_data ->> 'ownerSuggestionId', ''), contract_data ->> 'rightsHolderId', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then coalesce(nullif(contract_data ->> 'ownerSuggestionId', ''), contract_data ->> 'rightsHolderId')::uuid
    else null
  end;
  selected_employer_id := case when coalesce(contract_data ->> 'employerId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (contract_data ->> 'employerId')::uuid else null end;

  -- A malformed or cross-organisation suggestion is discarded rather than
  -- being allowed to enter either the legal owner column or the review queue.
  if selected_holder_id is not null and not exists (
    select 1
    from public.rettighedshavere as holder
    join public.org_affiliations as affiliation
      on affiliation.rights_holder_id = holder.id
    where affiliation.org_id = fenced.org_id
      and holder.id = selected_holder_id
      and holder.archived_at is null
      and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
      and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
  ) then
    selected_holder_id := null;
  end if;

  select document_job.* into source_document_job
  from public.contract_document_jobs as document_job
  where document_job.contract_id = fenced.contract_id
    and document_job.org_id = fenced.org_id
    and document_job.status = 'completed'
    and document_job.superseded_by_job_id is null
    and p_input_storage_path in (
      document_job.output_storage_path,
      document_job.original_storage_path,
      document_job.original_view_storage_path
    )
  order by document_job.completed_at desc nulls last, document_job.created_at desc
  limit 1;

  insert into public.contract_validations (
    contract_id, org_id, holiday_pay_rate, beta_rate, has_credit_clause,
    has_termination_clause, termination_days_editor,
    termination_days_producer, has_indemnification,
    has_overenskomst_incorporation, extracted_data
  ) values (
    fenced.contract_id,
    fenced.org_id,
    nullif(validation_data ->> 'holidayPayRate', '')::numeric,
    nullif(validation_data ->> 'betaRate', '')::numeric,
    coalesce((validation_data ->> 'hasCreditClause')::boolean, false),
    coalesce((validation_data ->> 'hasTerminationClause')::boolean, false),
    nullif(validation_data ->> 'terminationDaysEditor', '')::integer,
    nullif(validation_data ->> 'terminationDaysProducer', '')::integer,
    coalesce((validation_data ->> 'hasIndemnification')::boolean, false),
    coalesce((validation_data ->> 'hasOverenskomstIncorporation')::boolean, false),
    extracted
  )
  on conflict (contract_id) do update set
    holiday_pay_rate = excluded.holiday_pay_rate,
    beta_rate = excluded.beta_rate,
    has_credit_clause = excluded.has_credit_clause,
    has_termination_clause = excluded.has_termination_clause,
    termination_days_editor = excluded.termination_days_editor,
    termination_days_producer = excluded.termination_days_producer,
    has_indemnification = excluded.has_indemnification,
    has_overenskomst_incorporation = excluded.has_overenskomst_incorporation,
    extracted_data = excluded.extracted_data;

  update public.contracts
  set type = case when coalesce((contract_data ->> 'applyType')::boolean, false)
        then coalesce(nullif(contract_data ->> 'type', ''), 'a-løn') else type end,
      overenskomst = case when coalesce((contract_data ->> 'applyOverenskomst')::boolean, false)
        then nullif(contract_data ->> 'overenskomst', '') else overenskomst end,
      working_title = case when coalesce((contract_data ->> 'applyWorkingTitle')::boolean, false)
        then nullif(contract_data ->> 'workingTitle', '') else working_title end,
      contract_date = case when coalesce((contract_data ->> 'applyContractDate')::boolean, false)
        then nullif(contract_data ->> 'contractDate', '')::date else contract_date end,
      start_date = case when coalesce((contract_data ->> 'applyStartDate')::boolean, false)
        then nullif(contract_data ->> 'startDate', '')::date else start_date end,
      end_date = case when coalesce((contract_data ->> 'applyEndDate')::boolean, false)
        then nullif(contract_data ->> 'endDate', '')::date else end_date end,
      -- AI may fill an empty link, but a work selected manually while this
      -- generation was running is authoritative and must never be replaced by
      -- the stale pre-lock suggestion.
      work_id = coalesce(work_id, selected_work_id),
      employer_id = coalesce(employer_id, selected_employer_id)
  where id = fenced.contract_id and org_id = fenced.org_id;
  if not found then
    raise exception 'contract disappeared during fenced apply' using errcode = 'P0002';
  end if;

  if selected_holder_id is not null then
    insert into public.contract_owner_provenance (
      contract_id, org_id, rights_holder_id, origin, source_record_type,
      source_record_id, evidence_ai_job_id
    ) values (
      fenced.contract_id, fenced.org_id, selected_holder_id, 'ai_suggestion',
      'contract_ai_job', p_job_id, p_job_id
    )
    on conflict do nothing;

    if selected_holder_id is distinct from authoritative_holder_id then
      update public.contract_owner_verifications
      set proposed_rights_holder_id = selected_holder_id,
          status = case
            when assigned_rights_holder_id is null then 'correction_proposed'
            else 'conflict'
          end,
          assignment_origin = case
            when assigned_rights_holder_id is null then 'ai_suggestion'
            else assignment_origin
          end,
          reason_code = case
            when assigned_rights_holder_id is null then 'ai_candidate'
            else 'ai_owner_conflict'
          end,
          match_version = left(nullif(import_data ->> 'matchVersion', ''), 100),
          evidence_subject_rights_holder_id = selected_holder_id,
          evidence_ai_job_id = p_job_id,
          evidence_document_job_id = source_document_job.id,
          evidence_spatial_sha256 = source_document_job.spatial_sha256,
          evidence_spatial_schema_version = source_document_job.spatial_schema_version,
          reviewed_by = null,
          reviewed_at = null,
          revision = revision + 1,
          updated_at = now()
      where contract_id = fenced.contract_id
        and org_id = fenced.org_id
        and (
          status in ('pending', 'conflict', 'correction_proposed')
          or (status = 'confirmed' and reason_code = 'session_bound_owner')
        );
    else
      update public.contract_owner_verifications
      set proposed_rights_holder_id = null,
          status = case when status = 'confirmed' then 'confirmed' else 'pending' end,
          reason_code = case
            when status = 'confirmed' then reason_code
            else 'ai_matches_assigned'
          end,
          match_version = left(nullif(import_data ->> 'matchVersion', ''), 100),
          evidence_subject_rights_holder_id = selected_holder_id,
          evidence_ai_job_id = p_job_id,
          evidence_document_job_id = source_document_job.id,
          evidence_spatial_sha256 = source_document_job.spatial_sha256,
          evidence_spatial_schema_version = source_document_job.spatial_schema_version,
          revision = revision + 1,
          updated_at = now()
      where contract_id = fenced.contract_id
        and org_id = fenced.org_id
        and (
          status in ('pending', 'conflict', 'correction_proposed')
          or (status = 'confirmed' and reason_code = 'session_bound_owner')
        );
    end if;
  end if;

  if selected_employer_id is not null
    and not exists (select 1 from public.contract_employers where contract_id = fenced.contract_id) then
    insert into public.contract_employers (
      contract_id, employer_id, relation_role, sort_order, source
    )
    select fenced.contract_id, employer_id, 'counterparty', ordinality - 1, 'contract_import'
    from jsonb_array_elements_text(coalesce(p_payload -> 'employerIds', '[]'::jsonb))
      with ordinality as value(employer_text, ordinality)
    cross join lateral (select value.employer_text::uuid as employer_id) parsed
    on conflict do nothing;
  end if;

  if series_data is not null and jsonb_typeof(series_data) = 'object'
    and authoritative_holder_id is not null
    and coalesce(series_data ->> 'seriesWorkId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    selected_series_id := (series_data ->> 'seriesWorkId')::uuid;
    selected_season := greatest(1, least(1000, coalesce(nullif(series_data ->> 'seasonNumber', '')::integer, 1)));
    -- Series metadata was also prepared before the contract lock. Apply it only
    -- when it still describes the work that is currently linked to the
    -- contract; otherwise it could attach an episode scope to a manually linked
    -- film or to another series.
    if exists (
      select 1
      from public.contracts as current_contract
      join public.works as linked_work on linked_work.id = current_contract.work_id
      where current_contract.id = fenced.contract_id
        and current_contract.org_id = fenced.org_id
        and (
          linked_work.id = selected_series_id
          or linked_work.parent_work_id = selected_series_id
        )
    ) then
      insert into public.member_series_episode_scopes (
        org_id, rights_holder_id, series_work_id, season_number,
        status, episode_numbers, covers_whole_season, source, confirmed_at
      ) values (
        fenced.org_id, authoritative_holder_id, selected_series_id, selected_season,
        'pending', '{}', false, 'contract_upload', null
      )
      on conflict (org_id, rights_holder_id, series_work_id, season_number)
      do update set
        updated_at = case
          when public.member_series_episode_scopes.status = 'confirmed'
            then public.member_series_episode_scopes.updated_at
          else now()
        end,
        source = case
          when public.member_series_episode_scopes.status = 'confirmed'
            then public.member_series_episode_scopes.source
          else 'contract_upload'
        end
      returning * into selected_scope;

      update public.contracts
      set episode_scope_id = selected_scope.id,
          season_number = selected_scope.season_number,
          episode_numbers = case
            when selected_scope.status = 'confirmed' and selected_scope.covers_whole_season then '{}'
            when selected_scope.status = 'confirmed' then selected_scope.episode_numbers
            else null
          end
      where id = fenced.contract_id and org_id = fenced.org_id;
    end if;
  end if;

  -- The worker computed its payload before this transaction acquired the
  -- contract lock. An administrator may therefore have corrected an owner (or
  -- linked a work) while the worker was waiting. Derive every owner-dependent
  -- workflow state again from the locked, authoritative contract state. Only a
  -- duplicate classification is independent enough to survive from the match
  -- payload itself.
  actual_item_status := coalesce(nullif(import_data ->> 'status', ''), 'ready_for_review');
  if actual_item_status not in ('duplicate', 'possible_duplicate') then
    if authoritative_holder_id is null then
      actual_item_status := 'missing_owner';
    elsif not exists (
      select 1
      from public.contracts as current_contract
      where current_contract.id = fenced.contract_id
        and current_contract.org_id = fenced.org_id
        and current_contract.work_id is not null
    ) then
      actual_item_status := 'missing_work';
    elsif exists (
      select 1
      from public.contracts as current_contract
      join public.works as linked_work on linked_work.id = current_contract.work_id
      where current_contract.id = fenced.contract_id
        and current_contract.org_id = fenced.org_id
        and (
          linked_work.parent_work_id is not null
          or lower(coalesce(linked_work.type, '')) like '%serie%'
        )
    ) and not exists (
      select 1
      from public.contracts as current_contract
      join public.member_series_episode_scopes as current_scope
        on current_scope.id = current_contract.episode_scope_id
      where current_contract.id = fenced.contract_id
        and current_contract.org_id = fenced.org_id
        and current_scope.org_id = fenced.org_id
        and current_scope.rights_holder_id = authoritative_holder_id
        and current_scope.status = 'confirmed'
    ) then
      actual_item_status := 'awaiting_episode_confirmation';
    else
      actual_item_status := 'ready_for_review';
    end if;
  end if;

  update public.contract_import_items
  set status = actual_item_status,
      owner_match_score = nullif(import_data ->> 'ownerMatchScore', '')::numeric,
      work_match_score = nullif(import_data ->> 'workMatchScore', '')::numeric,
      producer_match_score = nullif(import_data ->> 'producerMatchScore', '')::numeric,
      owner_match_evidence = coalesce(import_data -> 'ownerMatchEvidence', '[]'::jsonb),
      work_match_evidence = coalesce(import_data -> 'workMatchEvidence', '[]'::jsonb),
      producer_match_evidence = coalesce(import_data -> 'producerMatchEvidence', '[]'::jsonb),
      owner_candidate_ids = coalesce(array(
        select candidate::uuid
        from jsonb_array_elements_text(coalesce(import_data -> 'ownerCandidateIds', '[]'::jsonb)) candidate
        where exists (
          select 1
          from public.org_affiliations as affiliation
          join public.rettighedshavere as holder
            on holder.id = affiliation.rights_holder_id
          where affiliation.org_id = fenced.org_id
            and affiliation.rights_holder_id = candidate::uuid
            and holder.archived_at is null
            and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
            and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
        )
      ), '{}'),
      work_candidate_ids = coalesce(array(
        select candidate::uuid from jsonb_array_elements_text(coalesce(import_data -> 'workCandidateIds', '[]'::jsonb)) candidate
      ), '{}'),
      producer_candidate_ids = coalesce(array(
        select candidate::uuid from jsonb_array_elements_text(coalesce(import_data -> 'producerCandidateIds', '[]'::jsonb)) candidate
      ), '{}'),
      possible_duplicate_of = case
        when coalesce(import_data ->> 'possibleDuplicateOf', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (import_data ->> 'possibleDuplicateOf')::uuid
        else null
      end,
      duplicate_evidence = coalesce(import_data -> 'duplicateEvidence', '[]'::jsonb),
      match_version = left(import_data ->> 'matchVersion', 100),
      error_code = null,
      error_message = null,
      updated_at = now()
  where ai_job_id = p_job_id
    -- A stale successful AI callback must not resurrect or mutate an item that
    -- another transaction has already classified as terminal, duplicate or
    -- failed. Active matching states are the only rows this callback owns.
    and status not in (
      'duplicate', 'possible_duplicate', 'completed', 'retryable_error',
      'blocked', 'needs_ocr', 'dead', 'cancelled'
    );

  update public.contract_ai_jobs
  set stage = 'finalizing', lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
  return actual_item_status;
end;
$$;

revoke all on function public.apply_contract_ai_extraction_v2(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_contract_ai_extraction_v2(uuid, uuid, text, jsonb)
  to service_role;

-- Server-side queue pagination keeps version-chain expansion and filtering out
-- of the browser.  Actor claims are checked against user_org_roles so a jurist
-- cannot obtain the queue merely by discovering this RPC.
create or replace function public.list_contract_owner_verification_queue(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_statuses text[] default null,
  p_assignment_origins text[] default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  contract_id uuid,
  org_id uuid,
  assigned_rights_holder_id uuid,
  assigned_rights_holder_name text,
  proposed_rights_holder_id uuid,
  proposed_rights_holder_name text,
  verification_status text,
  assignment_origin text,
  reason_code text,
  match_version text,
  evidence_ai_job_id uuid,
  evidence_document_job_id uuid,
  evidence_spatial_sha256 text,
  evidence_spatial_schema_version text,
  evidence_page integer,
  evidence_bbox jsonb,
  evidence_confidence numeric,
  reviewed_by uuid,
  reviewed_at timestamptz,
  revision bigint,
  updated_at timestamptz,
  working_title text,
  contract_status text,
  contract_created_at timestamptz,
  document_processing_status text,
  document_processing_error_code text,
  superseded_by_contract_id uuid,
  version_group_id uuid,
  version_index integer,
  version_count integer,
  is_current_version boolean,
  ai_evidence_available boolean,
  spatial_evidence_available boolean,
  total_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_actor_role = 'jurist' then
    raise exception 'Jurister har ikke adgang til ejerskabskontrollen'
      using errcode = '42501';
  end if;
  if p_org_id is null or p_actor_user_id is null
    or p_actor_role not in ('superadmin', 'admin', 'org-admin')
    or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or char_length(coalesce(p_search, '')) > 200
    or exists (
      select 1 from unnest(coalesce(p_statuses, '{}'::text[])) as requested_status
      where requested_status not in (
        'pending', 'confirmed', 'conflict', 'correction_proposed', 'corrected', 'blocked', 'not_applicable'
      )
    )
    or exists (
      select 1 from unnest(coalesce(p_assignment_origins, '{}'::text[])) as requested_origin
      where requested_origin not in (
        'authenticated_member_upload', 'authenticated_member_drive',
        'admin_selected_at_intake', 'admin_manual', 'gmail_import', 'ai_suggestion',
        'historical_assignment', 'profile_merge', 'unknown'
      )
    ) then
    raise exception 'Ugyldige køparametre' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.user_org_roles as actor_role
    where actor_role.user_id = p_actor_user_id
      and actor_role.role = p_actor_role
      and actor_role.role in ('superadmin', 'admin', 'org-admin')
      and (actor_role.role = 'superadmin' or actor_role.org_id = p_org_id)
  ) then
    raise exception 'Administratorrollen kunne ikke verificeres' using errcode = '42501';
  end if;

  return query
  with recursive version_chain as (
    select
      oldest.id as chain_contract_id,
      oldest.id as chain_group_id,
      1 as chain_index,
      array[oldest.id]::uuid[] as visited
    from public.contracts as oldest
    where oldest.org_id = p_org_id
      and not exists (
        select 1 from public.contracts as predecessor
        where predecessor.org_id = p_org_id
          and predecessor.superseded_by_contract_id = oldest.id
      )

    union all

    select
      newer.id,
      chain.chain_group_id,
      chain.chain_index + 1,
      chain.visited || newer.id
    from version_chain as chain
    join public.contracts as current_contract
      on current_contract.id = chain.chain_contract_id
     and current_contract.org_id = p_org_id
    join public.contracts as newer
      on newer.id = current_contract.superseded_by_contract_id
     and newer.org_id = p_org_id
    where chain.chain_index < 1000
      and not newer.id = any(chain.visited)
  ), all_version_rows as (
    select chain_contract_id, chain_group_id, chain_index
    from version_chain
    union all
    select orphaned.id, orphaned.id, 1
    from public.contracts as orphaned
    where orphaned.org_id = p_org_id
      and not exists (
        select 1 from version_chain as reached
        where reached.chain_contract_id = orphaned.id
      )
  ), versioned as (
    select
      row.chain_contract_id,
      row.chain_group_id,
      row.chain_index,
      count(*) over (partition by row.chain_group_id)::integer as chain_count
    from all_version_rows as row
  ), filtered as (
    select
      verification.contract_id,
      verification.org_id,
      verification.assigned_rights_holder_id,
      assigned_holder.full_name as assigned_rights_holder_name,
      verification.proposed_rights_holder_id,
      proposed_holder.full_name as proposed_rights_holder_name,
      verification.status as verification_status,
      verification.assignment_origin,
      verification.reason_code,
      verification.match_version,
      verification.evidence_ai_job_id,
      verification.evidence_document_job_id,
      verification.evidence_spatial_sha256,
      verification.evidence_spatial_schema_version,
      verification.evidence_page,
      verification.evidence_bbox,
      verification.evidence_confidence,
      verification.reviewed_by,
      verification.reviewed_at,
      verification.revision,
      verification.updated_at,
      contract.working_title,
      contract.status as contract_status,
      contract.created_at as contract_created_at,
      contract.document_processing_status,
      contract.document_processing_error_code,
      contract.superseded_by_contract_id,
      versioned.chain_group_id as version_group_id,
      versioned.chain_index as version_index,
      versioned.chain_count as version_count,
      contract.superseded_by_contract_id is null as is_current_version,
      exists (
        select 1
        from public.contract_ai_jobs as evidence_job
        where evidence_job.id = verification.evidence_ai_job_id
          and evidence_job.contract_id = contract.id
          and evidence_job.org_id = contract.org_id
          and evidence_job.attachment_id is null
          and evidence_job.status = 'done'
          and evidence_job.superseded_by_job_id is null
      ) as ai_evidence_available,
      exists (
        select 1
        from public.contract_document_jobs as evidence_job
        where evidence_job.id = verification.evidence_document_job_id
          and evidence_job.contract_id = contract.id
          and evidence_job.org_id = contract.org_id
          and evidence_job.status = 'completed'
          and evidence_job.superseded_by_job_id is null
          and evidence_job.spatial_sha256 is not distinct from verification.evidence_spatial_sha256
          and evidence_job.spatial_schema_version is not distinct from verification.evidence_spatial_schema_version
          and verification.evidence_spatial_sha256 is not null
          and verification.evidence_spatial_schema_version = 'google-vision-spatial-v3'
          and evidence_job.spatial_data_path is not null
          and coalesce(evidence_job.spatial_accuracy_score, 0) >= 0.95
      ) as spatial_evidence_available
    from public.contract_owner_verifications as verification
    join public.contracts as contract
      on contract.id = verification.contract_id
     and contract.org_id = verification.org_id
    join versioned on versioned.chain_contract_id = contract.id
    left join public.rettighedshavere as assigned_holder
      on assigned_holder.id = verification.assigned_rights_holder_id
    left join public.rettighedshavere as proposed_holder
      on proposed_holder.id = verification.proposed_rights_holder_id
    where verification.org_id = p_org_id
      and (
        p_statuses is null or cardinality(p_statuses) = 0
        or verification.status = any(p_statuses)
      )
      and (
        p_assignment_origins is null or cardinality(p_assignment_origins) = 0
        or verification.assignment_origin = any(p_assignment_origins)
      )
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or position(lower(btrim(p_search)) in lower(coalesce(contract.working_title, ''))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(assigned_holder.full_name, ''))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(proposed_holder.full_name, ''))) > 0
      )
  )
  select
    filtered.contract_id,
    filtered.org_id,
    filtered.assigned_rights_holder_id,
    filtered.assigned_rights_holder_name,
    filtered.proposed_rights_holder_id,
    filtered.proposed_rights_holder_name,
    filtered.verification_status,
    filtered.assignment_origin,
    filtered.reason_code,
    filtered.match_version,
    filtered.evidence_ai_job_id,
    filtered.evidence_document_job_id,
    filtered.evidence_spatial_sha256,
    filtered.evidence_spatial_schema_version,
    filtered.evidence_page,
    filtered.evidence_bbox,
    filtered.evidence_confidence,
    filtered.reviewed_by,
    filtered.reviewed_at,
    filtered.revision,
    filtered.updated_at,
    filtered.working_title,
    filtered.contract_status,
    filtered.contract_created_at,
    filtered.document_processing_status,
    filtered.document_processing_error_code,
    filtered.superseded_by_contract_id,
    filtered.version_group_id,
    filtered.version_index,
    filtered.version_count,
    filtered.is_current_version,
    filtered.ai_evidence_available,
    filtered.spatial_evidence_available,
    count(*) over () as total_count
  from filtered
  order by
    case filtered.verification_status
      when 'blocked' then 0
      when 'correction_proposed' then 1
      when 'pending' then 2
      else 3
    end,
    filtered.is_current_version desc,
    filtered.contract_created_at desc,
    filtered.contract_id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.list_contract_owner_verification_queue(
  uuid, uuid, text, text[], text[], text, integer, integer
) from public, anon, authenticated;
grant execute on function public.list_contract_owner_verification_queue(
  uuid, uuid, text, text[], text[], text, integer, integer
) to service_role;

-- Manual owner discovery must bind the candidate and its immutable source in
-- one locked transaction. A client-side read/insert/update sequence could
-- otherwise leave provenance behind after a concurrent reassignment.
create or replace function public.record_contract_owner_candidate(
  p_contract_id uuid,
  p_org_id uuid,
  p_proposed_rights_holder_id uuid,
  p_evidence_ai_job_id uuid,
  p_evidence_document_job_id uuid default null,
  p_match_version text default null,
  p_match_score numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_contract public.contracts%rowtype;
  locked_verification public.contract_owner_verifications%rowtype;
  evidence_ai_job public.contract_ai_jobs%rowtype;
  evidence_document_job public.contract_document_jobs%rowtype;
  next_proposal uuid;
  next_status text;
  next_reason text;
  next_origin text;
  next_confidence numeric;
  preserve_review boolean;
  provenance_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Kun serveren kan registrere et ejerforslag' using errcode = '42501';
  end if;
  if p_contract_id is null or p_org_id is null
    or p_proposed_rights_holder_id is null or p_evidence_ai_job_id is null
    or (p_match_version is not null and char_length(p_match_version) not between 1 and 100)
    or (p_match_score is not null and p_match_score not between 0 and 100) then
    raise exception 'Ugyldigt ejerforslag' using errcode = '22023';
  end if;

  select * into locked_contract
  from public.contracts
  where id = p_contract_id
  for update;
  if locked_contract.id is null or locked_contract.org_id <> p_org_id then
    raise exception 'Kontrakten findes ikke i organisationen' using errcode = '42501';
  end if;

  select * into locked_verification
  from public.contract_owner_verifications
  where contract_id = locked_contract.id
    and org_id = locked_contract.org_id
  for update;
  if locked_verification.contract_id is null
    or locked_verification.assigned_rights_holder_id is distinct from locked_contract.rights_holder_id then
    raise exception 'Ejerskabskontrollen mangler eller er ikke synkroniseret'
      using errcode = '23514';
  end if;

  -- A final/manual decision is never silently reopened by a later search.
  if locked_verification.status in ('corrected', 'blocked', 'not_applicable')
    or (
      locked_verification.status = 'confirmed'
      and locked_verification.reason_code in (
        'admin_verified_existing_owner',
        'bulk_confirmed_existing_owner',
        'manual_identity_check'
      )
    ) then
    return jsonb_build_object(
      'contractId', locked_contract.id,
      'status', locked_verification.status,
      'revision', locked_verification.revision,
      'skipped', true
    );
  end if;

  if not exists (
    select 1
    from public.rettighedshavere as holder
    join public.org_affiliations as affiliation
      on affiliation.rights_holder_id = holder.id
     and affiliation.org_id = locked_contract.org_id
     and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
     and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
    where holder.id = p_proposed_rights_holder_id
      and holder.archived_at is null
  ) then
    raise exception 'Den foreslåede rettighedshaver er ikke aktiv i organisationen'
      using errcode = '42501';
  end if;

  select * into evidence_ai_job
  from public.contract_ai_jobs as job
  where job.id = p_evidence_ai_job_id
    and job.contract_id = locked_contract.id
    and job.org_id = locked_contract.org_id
    and job.status = 'done'
    and job.stage = 'complete'
    and job.attachment_id is null
    and job.superseded_by_job_id is null
  for update;
  if evidence_ai_job.id is null then
    raise exception 'AI-kilden er ikke den aktuelle kontraktanalyse' using errcode = '22023';
  end if;

  if p_evidence_document_job_id is not null then
    select * into evidence_document_job
    from public.contract_document_jobs as job
    where job.id = p_evidence_document_job_id
      and job.contract_id = locked_contract.id
      and job.org_id = locked_contract.org_id
      and job.status = 'completed'
      and job.superseded_by_job_id is null
    for update;
    if evidence_document_job.id is null
      or evidence_ai_job.input_storage_path is null
      or (
        evidence_ai_job.input_storage_path is distinct from evidence_document_job.output_storage_path
        and evidence_ai_job.input_storage_path is distinct from evidence_document_job.original_storage_path
        and evidence_ai_job.input_storage_path is distinct from evidence_document_job.original_view_storage_path
      ) then
      raise exception 'Dokumentkilden matcher ikke AI-analysens dokumentversion'
        using errcode = '22023';
    end if;
  end if;

  next_proposal := case
    when p_proposed_rights_holder_id is distinct from locked_contract.rights_holder_id
      then p_proposed_rights_holder_id
    else null
  end;
  next_status := case
    when next_proposal is null and locked_verification.status = 'confirmed' then 'confirmed'
    when next_proposal is null then 'pending'
    when locked_contract.rights_holder_id is null then 'correction_proposed'
    else 'conflict'
  end;
  next_reason := case when next_proposal is null then 'ai_matches_assigned' else 'ai_candidate' end;
  next_origin := case
    when locked_contract.rights_holder_id is null then 'ai_suggestion'
    else locked_verification.assignment_origin
  end;
  next_confidence := case when p_match_score is null then null else p_match_score / 100 end;
  preserve_review := next_status = 'confirmed' and locked_verification.status = 'confirmed';

  -- Retrying the same exact evidence is idempotent and does not churn revision.
  if locked_verification.proposed_rights_holder_id is not distinct from next_proposal
    and locked_verification.status = next_status
    and locked_verification.assignment_origin = next_origin
    and locked_verification.reason_code is not distinct from next_reason
    and locked_verification.match_version is not distinct from p_match_version
    and locked_verification.evidence_subject_rights_holder_id = p_proposed_rights_holder_id
    and locked_verification.evidence_ai_job_id = evidence_ai_job.id
    and locked_verification.evidence_document_job_id is not distinct from evidence_document_job.id
    and locked_verification.evidence_spatial_sha256 is not distinct from evidence_document_job.spatial_sha256
    and locked_verification.evidence_spatial_schema_version is not distinct from evidence_document_job.spatial_schema_version
    and locked_verification.evidence_confidence is not distinct from next_confidence then
    return jsonb_build_object(
      'contractId', locked_contract.id,
      'status', locked_verification.status,
      'revision', locked_verification.revision,
      'skipped', false,
      'unchanged', true
    );
  end if;

  insert into public.contract_owner_provenance (
    contract_id,
    org_id,
    rights_holder_id,
    origin,
    source_record_type,
    source_record_id,
    evidence_ai_job_id
  ) values (
    locked_contract.id,
    locked_contract.org_id,
    p_proposed_rights_holder_id,
    'ai_suggestion',
    'contract_ai_job',
    evidence_ai_job.id,
    evidence_ai_job.id
  )
  on conflict do nothing
  returning id into provenance_id;

  update public.contract_owner_verifications
  set proposed_rights_holder_id = next_proposal,
      status = next_status,
      assignment_origin = next_origin,
      reason_code = next_reason,
      match_version = p_match_version,
      evidence_subject_rights_holder_id = p_proposed_rights_holder_id,
      evidence_ai_job_id = evidence_ai_job.id,
      evidence_document_job_id = evidence_document_job.id,
      evidence_spatial_sha256 = evidence_document_job.spatial_sha256,
      evidence_spatial_schema_version = evidence_document_job.spatial_schema_version,
      evidence_page = null,
      evidence_bbox = null,
      evidence_confidence = next_confidence,
      reviewed_by = case when preserve_review then reviewed_by else null end,
      reviewed_at = case when preserve_review then reviewed_at else null end,
      revision = revision + 1,
      updated_at = now()
  where contract_id = locked_contract.id;

  return jsonb_build_object(
    'contractId', locked_contract.id,
    'status', next_status,
    'revision', locked_verification.revision + 1,
    'provenanceId', provenance_id,
    'skipped', false,
    'unchanged', false
  );
end;
$$;

revoke all on function public.record_contract_owner_candidate(
  uuid, uuid, uuid, uuid, uuid, text, numeric
) from public, anon, authenticated;
grant execute on function public.record_contract_owner_candidate(
  uuid, uuid, uuid, uuid, uuid, text, numeric
) to service_role;

-- Profile merging is the only bulk identity operation that may legitimately
-- replace an established owner outside review_contract_owner().  Keep the
-- existing, battle-tested merge implementation intact behind a revoked name,
-- and expose a narrow security-definer wrapper which verifies the actor,
-- remaps owner verification/provenance, and then invokes the legacy merge in
-- the same transaction.  Any failure rolls every step back.
alter function public.merge_duplicate_rights_holders(uuid, uuid, uuid, uuid, text)
  rename to merge_duplicate_rights_holders_pre_owner_verify_20260902;

revoke all on function public.merge_duplicate_rights_holders_pre_owner_verify_20260902(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.merge_duplicate_rights_holders(
  p_primary_id uuid,
  p_duplicate_id uuid,
  p_actor_user_id uuid,
  p_actor_org_id uuid,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_holder public.rettighedshavere%rowtype;
  duplicate_holder public.rettighedshavere%rowtype;
  affected_contract record;
  merged_comment_ids uuid[] := '{}'::uuid[];
  merge_result jsonb;
  verified_superadmin_org_id uuid;
begin
  if p_primary_id is null or p_duplicate_id is null or p_primary_id = p_duplicate_id then
    raise exception 'Vælg to forskellige rettighedshavere' using errcode = '22023';
  end if;
  if p_actor_user_id is null or p_actor_org_id is null or p_actor_role <> 'superadmin' then
    raise exception 'Kun superadmin kan sammenlægge rettighedshavere' using errcode = '42501';
  end if;
  select actor_role.org_id
  into verified_superadmin_org_id
  from public.user_org_roles as actor_role
  where actor_role.user_id = p_actor_user_id
    and actor_role.role = 'superadmin'
  order by actor_role.org_id
  limit 1;
  if verified_superadmin_org_id is null then
    raise exception 'Superadminrollen kunne ikke verificeres' using errcode = '42501';
  end if;
  -- Superadmin is global even though the legacy core historically required the
  -- role row and actor org to be identical. p_actor_org_id remains the active
  -- target context below; the core receives the verified role org solely for
  -- its legacy guard, while its affected_org_ids audit includes the target.
  if not exists (
    select 1
    from public.organisations as target_org
    where target_org.id = p_actor_org_id
  ) then
    raise exception 'Målorganisationen kunne ikke verificeres' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.org_affiliations as primary_affiliation
    join public.org_affiliations as duplicate_affiliation
      on duplicate_affiliation.org_id = primary_affiliation.org_id
    where primary_affiliation.org_id = p_actor_org_id
      and primary_affiliation.rights_holder_id = p_primary_id
      and duplicate_affiliation.rights_holder_id = p_duplicate_id
  ) then
    raise exception 'Profilerne er ikke begge tilknyttet målorganisationen'
      using errcode = '42501';
  end if;

  -- A stable lock order prevents concurrent merges of the same profiles from
  -- deadlocking or observing a half-moved owner relation.
  perform 1
  from public.rettighedshavere
  where id in (p_primary_id, p_duplicate_id)
  order by id
  for update;

  select * into primary_holder
  from public.rettighedshavere
  where id = p_primary_id;
  select * into duplicate_holder
  from public.rettighedshavere
  where id = p_duplicate_id;
  if primary_holder.id is null or duplicate_holder.id is null then
    raise exception 'En af rettighedshaverne findes ikke' using errcode = 'P0002';
  end if;

  -- The transaction-local scope is consumed by the immutable provenance and
  -- contract-owner guards. It cannot be supplied through PostgREST requests.
  perform set_config('app.contract_owner_change_scope', 'profile_merge', true);

  -- Add an explicit merge event before rewriting historical identifiers.  The
  -- source profile ID remains as non-content provenance after the profile row
  -- has been removed.
  for affected_contract in
    select contract.id, contract.org_id
    from public.contracts as contract
    where contract.rights_holder_id = p_duplicate_id
    order by contract.id
    for update
  loop
    insert into public.contract_owner_provenance (
      contract_id,
      org_id,
      rights_holder_id,
      origin,
      authenticated_user_id,
      source_record_type,
      source_record_id
    ) values (
      affected_contract.id,
      affected_contract.org_id,
      p_primary_id,
      'profile_merge',
      p_actor_user_id,
      'rights_holder',
      p_duplicate_id
    )
    on conflict do nothing;
  end loop;

  -- If both profiles already have the exact same provenance key, retain the
  -- primary row and remove only the duplicate collision. All remaining rows
  -- are identity-remapped without changing their historical origin.
  delete from public.contract_owner_provenance as source
  using public.contract_owner_provenance as target
  where source.rights_holder_id = p_duplicate_id
    and target.rights_holder_id = p_primary_id
    and target.contract_id = source.contract_id
    and target.origin = source.origin
    and coalesce(target.source_record_type, '') = coalesce(source.source_record_type, '')
    and coalesce(target.source_record_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(source.source_record_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(target.evidence_ai_job_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(source.evidence_ai_job_id, '00000000-0000-0000-0000-000000000000'::uuid);

  update public.contract_owner_provenance
  set rights_holder_id = p_primary_id
  where rights_holder_id = p_duplicate_id;

  update public.contract_owner_verifications
  set assigned_rights_holder_id = case
        when assigned_rights_holder_id = p_duplicate_id then p_primary_id
        else assigned_rights_holder_id
      end,
      proposed_rights_holder_id = case
        when proposed_rights_holder_id in (p_primary_id, p_duplicate_id)
          and assigned_rights_holder_id in (p_primary_id, p_duplicate_id)
          then null
        when proposed_rights_holder_id = p_duplicate_id then p_primary_id
        else proposed_rights_holder_id
      end,
      evidence_subject_rights_holder_id = case
        when evidence_subject_rights_holder_id = p_duplicate_id then p_primary_id
        else evidence_subject_rights_holder_id
      end,
      status = case
        when status in ('conflict', 'correction_proposed')
          and proposed_rights_holder_id in (p_primary_id, p_duplicate_id)
          and assigned_rights_holder_id in (p_primary_id, p_duplicate_id)
          then 'pending'
        else status
      end,
      assignment_origin = case
        when assigned_rights_holder_id = p_duplicate_id then 'profile_merge'
        else assignment_origin
      end,
      reason_code = 'profile_merged',
      reviewed_by = case
        when status in ('conflict', 'correction_proposed')
          and proposed_rights_holder_id in (p_primary_id, p_duplicate_id)
          and assigned_rights_holder_id in (p_primary_id, p_duplicate_id)
          then null
        else reviewed_by
      end,
      reviewed_at = case
        when status in ('conflict', 'correction_proposed')
          and proposed_rights_holder_id in (p_primary_id, p_duplicate_id)
          and assigned_rights_holder_id in (p_primary_id, p_duplicate_id)
          then null
        else reviewed_at
      end,
      revision = revision + 1,
      updated_at = now()
  where assigned_rights_holder_id = p_duplicate_id
     or proposed_rights_holder_id = p_duplicate_id
     or evidence_subject_rights_holder_id = p_duplicate_id;

  select coalesce(array_agg(comment.id order by comment.id), '{}'::uuid[])
  into merged_comment_ids
  from public.contract_comments as comment
  where comment.member_rights_holder_id = p_duplicate_id;

  merge_result := public.merge_duplicate_rights_holders_pre_owner_verify_20260902(
    p_primary_id,
    p_duplicate_id,
    p_actor_user_id,
    verified_superadmin_org_id,
    p_actor_role
  );

  -- The legacy merge deletes the duplicate profile, so ON DELETE SET NULL
  -- first removes the obsolete participant FK. Restore only the exact comment
  -- rows captured above, and only after the contract owner is the primary.
  update public.contract_comments
  set member_rights_holder_id = p_primary_id
  where id = any(merged_comment_ids)
    and member_rights_holder_id is null;

  return merge_result;
end;
$$;

revoke all on function public.merge_duplicate_rights_holders(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.merge_duplicate_rights_holders(
  uuid, uuid, uuid, uuid, text
) to service_role;

-- PDF, DOC and DOCX follow the same document-worker path.  TXT is the only
-- supported format that may still enter AI extraction directly.  The owner
-- identity is bound to the authenticated upload intent in the same transaction
-- that creates the contract and its first job.
create or replace function public.create_member_uploaded_contract(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_upload_intent_id uuid,
  p_storage_path text,
  p_uploaded_size bigint,
  p_working_title text default null,
  p_work_id uuid default null,
  p_season_number integer default null,
  p_episode_numbers integer[] default null,
  p_defer_ai_job boolean default false
)
returns public.contracts
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_intent public.contract_upload_intents;
  created_contract public.contracts;
  new_contract_id uuid := gen_random_uuid();
  new_document_job_id uuid;
  needs_document_processing boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_uploaded_size < 1 or p_uploaded_size > 26214400
    or nullif(p_storage_path, '') is null
    or p_storage_path ~ '[\r\n]'
    or lower(p_storage_path) !~ '[.](pdf|doc|docx|txt)$'
    or (p_season_number is not null and p_season_number < 1)
    or exists (
      select 1 from unnest(coalesce(p_episode_numbers, '{}'::integer[])) as episode_number
      where episode_number < 1
    ) then
    raise exception 'invalid uploaded contract' using errcode = '22023';
  end if;

  needs_document_processing := lower(p_storage_path) ~ '[.](pdf|doc|docx)$';

  select * into upload_intent
  from public.contract_upload_intents
  where id = p_upload_intent_id
  for update;

  if upload_intent.id is null
    or upload_intent.owner_id <> p_owner_id
    or upload_intent.org_id <> p_org_id
    or upload_intent.rights_holder_id <> p_rights_holder_id
    or upload_intent.storage_path <> p_storage_path
    or upload_intent.expected_size <> p_uploaded_size then
    raise exception 'upload intent mismatch' using errcode = '42501';
  end if;
  if upload_intent.cleanup_status = 'claimed' then
    raise exception 'upload intent cleanup in progress' using errcode = 'P0002';
  end if;

  if upload_intent.contract_id is not null then
    select * into created_contract
    from public.contracts
    where id = upload_intent.contract_id
      and org_id = p_org_id
      and rights_holder_id = p_rights_holder_id
      and pdf_url = p_storage_path;
    if created_contract.id is null
      or (needs_document_processing and not exists (
          select 1 from public.contract_document_jobs
          where contract_id = created_contract.id
        ))
      or (not needs_document_processing and not coalesce(p_defer_ai_job, false) and not exists (
          select 1 from public.contract_ai_jobs
          where contract_id = created_contract.id and attachment_id is null
        )) then
      raise exception 'inconsistent uploaded contract' using errcode = 'P0002';
    end if;
    return created_contract;
  end if;

  if upload_intent.consumed_at is not null or upload_intent.expires_at <= now() then
    raise exception 'upload intent expired or consumed' using errcode = 'P0002';
  end if;

  insert into public.contracts (
    id, org_id, rights_holder_id, type, status, pdf_url, working_title,
    work_id, season_number, episode_numbers, created_by
  ) values (
    new_contract_id, p_org_id, p_rights_holder_id, 'a-løn', 'kladde',
    p_storage_path, nullif(btrim(p_working_title), ''), p_work_id,
    p_season_number, p_episode_numbers, p_owner_id
  ) returning * into created_contract;

  if needs_document_processing then
    new_document_job_id := gen_random_uuid();
    insert into public.contract_document_jobs (
      id, contract_id, org_id, created_by, original_storage_path,
      output_storage_path, status, priority, next_attempt_at,
      downstream_ai_policy
    ) values (
      new_document_job_id, created_contract.id, p_org_id, p_owner_id,
      p_storage_path,
      p_org_id::text || '/processed/' || created_contract.id::text
        || '/pending/' || new_document_job_id::text || '/normalised.pdf',
      'queued', 100, now() + interval '2 hours', 'reanalyze'
    );
  elsif not coalesce(p_defer_ai_job, false) then
    insert into public.contract_ai_jobs (
      contract_id, org_id, created_by, status, stage, priority, next_attempt_at
    ) values (
      created_contract.id, p_org_id, p_owner_id,
      'queued', 'extraction', 0, now() + interval '2 hours'
    );
  end if;

  update public.contract_upload_intents
  set consumed_at = now(), contract_id = created_contract.id
  where id = upload_intent.id;

  perform public.record_contract_owner_provenance(
    created_contract.id,
    p_org_id,
    p_rights_holder_id,
    'authenticated_member_upload',
    p_owner_id,
    'contract_upload_intent',
    upload_intent.id,
    null
  );

  return created_contract;
end;
$$;

revoke all on function public.create_member_uploaded_contract(
  uuid, uuid, uuid, uuid, text, bigint, text, uuid, integer, integer[], boolean
) from public, anon, authenticated;
grant execute on function public.create_member_uploaded_contract(
  uuid, uuid, uuid, uuid, text, bigint, text, uuid, integer, integer[], boolean
) to service_role;

create or replace function public.claim_member_uploaded_contract_finalization(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_upload_intent_id uuid,
  p_contract_id uuid,
  p_storage_path text,
  p_request_hash text,
  p_finalization_token uuid
)
returns table (outcome text, finalization_token uuid, contract_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_intent public.contract_upload_intents;
  uploaded_contract public.contracts;
  document_job_count integer;
  ai_job_count integer;
  needs_document_processing boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_upload_intent_id is null or p_contract_id is null
    or nullif(p_storage_path, '') is null or p_storage_path ~ '[\r\n]'
    or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_finalization_token is null then
    raise exception 'invalid upload finalization claim' using errcode = '22023';
  end if;
  needs_document_processing := lower(p_storage_path) ~ '[.](pdf|doc|docx)$';

  select * into upload_intent
  from public.contract_upload_intents as intent
  where intent.id = p_upload_intent_id
  for update;
  if upload_intent.id is null
    or upload_intent.owner_id is distinct from p_owner_id
    or upload_intent.org_id is distinct from p_org_id
    or upload_intent.rights_holder_id is distinct from p_rights_holder_id
    or upload_intent.storage_path is distinct from p_storage_path
    or upload_intent.contract_id is distinct from p_contract_id
    or upload_intent.consumed_at is null then
    raise exception 'upload finalization identity mismatch' using errcode = '42501';
  end if;
  if upload_intent.cleanup_status = 'claimed' then
    raise exception 'upload intent cleanup in progress' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.contracts as contract
    where contract.id = p_contract_id
      and contract.org_id = p_org_id
      and contract.rights_holder_id = p_rights_holder_id
      and contract.created_by = p_owner_id
      and contract.pdf_url = p_storage_path
  ) then
    raise exception 'uploaded contract mismatch' using errcode = '42501';
  end if;

  if upload_intent.finalization_status = 'finalized' then
    if upload_intent.finalization_request_hash is distinct from p_request_hash then
      raise exception 'upload request differs from finalized request' using errcode = 'P0002';
    end if;
    return query select 'already_finalized'::text, null::uuid, p_contract_id;
    return;
  end if;
  if upload_intent.finalization_status = 'processing' then
    if upload_intent.finalization_request_hash is distinct from p_request_hash then
      raise exception 'upload finalization already claimed by another request' using errcode = 'P0002';
    end if;
    if upload_intent.finalization_claimed_at > now() - interval '10 minutes' then
      if upload_intent.finalization_token = p_finalization_token then
        return query select 'claimed'::text, p_finalization_token, p_contract_id;
        return;
      end if;
      return query select 'in_progress'::text, null::uuid, p_contract_id;
      return;
    end if;
  end if;
  if upload_intent.finalization_status not in ('pending', 'processing') then
    raise exception 'upload finalization is not available' using errcode = 'P0002';
  end if;

  perform job.id
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  perform job.id
  from public.contract_ai_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  select * into uploaded_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;
  select count(*) into document_job_count
  from public.contract_document_jobs as job where job.contract_id = p_contract_id;
  select count(*) into ai_job_count
  from public.contract_ai_jobs as job where job.contract_id = p_contract_id;

  if uploaded_contract.id is null
    or uploaded_contract.org_id is distinct from p_org_id
    or uploaded_contract.rights_holder_id is distinct from p_rights_holder_id
    or uploaded_contract.created_by is distinct from p_owner_id
    or uploaded_contract.pdf_url is distinct from p_storage_path
    or uploaded_contract.status is distinct from 'kladde'
    or (
      needs_document_processing
      and (
        document_job_count <> 1
        or ai_job_count <> 0
        or exists (
          select 1 from public.contract_document_jobs as job
          where job.contract_id = p_contract_id
            and (
              job.status <> 'queued'
              or job.attempts <> 0
              or job.lease_token is not null
              or job.lease_expires_at is not null
              or job.last_upload_authorised_at is not null
            )
        )
      )
    )
    or (
      not needs_document_processing
      and (
        document_job_count <> 0
        or ai_job_count > 1
        or exists (
          select 1 from public.contract_ai_jobs as job
          where job.contract_id = p_contract_id
            and (
              job.status <> 'queued'
              or job.attempts <> 0
              or job.started_at is not null
              or job.lease_expires_at is not null
            )
        )
      )
    ) then
    return query select 'recovery_required'::text, null::uuid, p_contract_id;
    return;
  end if;

  update public.contract_document_jobs as job
  set next_attempt_at = greatest(job.next_attempt_at, now() + interval '10 minutes'),
      updated_at = now()
  where job.contract_id = p_contract_id;
  update public.contract_ai_jobs as job
  set next_attempt_at = greatest(job.next_attempt_at, now() + interval '10 minutes'),
      updated_at = now()
  where job.contract_id = p_contract_id;

  if upload_intent.finalization_status = 'processing' then
    update public.contract_upload_intents as intent
    set finalization_claimed_at = now(), finalization_token = p_finalization_token
    where intent.id = upload_intent.id
      and intent.finalization_status = 'processing'
      and intent.finalization_token = upload_intent.finalization_token;
  else
    update public.contract_upload_intents as intent
    set finalization_status = 'processing',
        finalization_claimed_at = now(),
        finalization_token = p_finalization_token,
        finalization_request_hash = p_request_hash
    where intent.id = upload_intent.id
      and intent.finalization_status = 'pending';
  end if;
  if not found then
    raise exception 'upload finalization lease lost' using errcode = 'P0002';
  end if;
  return query select 'claimed'::text, p_finalization_token, p_contract_id;
end;
$$;

revoke all on function public.claim_member_uploaded_contract_finalization(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.claim_member_uploaded_contract_finalization(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid
) to service_role;

create or replace function public.rollback_member_uploaded_contract(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_upload_intent_id uuid,
  p_contract_id uuid,
  p_storage_path text,
  p_finalization_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_intent public.contract_upload_intents;
  uploaded_contract public.contracts;
  document_job_count integer;
  needs_document_processing boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_upload_intent_id is null or p_contract_id is null
    or nullif(p_storage_path, '') is null or p_storage_path ~ '[\r\n]'
    or p_finalization_token is null then
    raise exception 'invalid upload rollback' using errcode = '22023';
  end if;
  needs_document_processing := lower(p_storage_path) ~ '[.](pdf|doc|docx)$';

  select * into upload_intent
  from public.contract_upload_intents as intent
  where intent.id = p_upload_intent_id
  for update;

  if upload_intent.id is null
    or upload_intent.owner_id is distinct from p_owner_id
    or upload_intent.org_id is distinct from p_org_id
    or upload_intent.rights_holder_id is distinct from p_rights_holder_id
    or upload_intent.storage_path is distinct from p_storage_path
    or upload_intent.contract_id is distinct from p_contract_id
    or upload_intent.consumed_at is null
    or upload_intent.cleanup_status = 'claimed'
    or upload_intent.finalization_status <> 'processing'
    or upload_intent.finalization_token is distinct from p_finalization_token
    or upload_intent.finalization_claimed_at <= now() - interval '10 minutes' then
    return false;
  end if;

  perform job.id
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  select count(*) into document_job_count
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id;
  if (needs_document_processing and document_job_count <> 1)
    or exists (
      select 1
      from public.contract_document_jobs as job
      where job.contract_id = p_contract_id
        and (
          job.status <> 'queued'
          or job.attempts <> 0
          or job.lease_token is not null
          or job.last_upload_authorised_at is not null
        )
    ) then
    return false;
  end if;

  perform job.id
  from public.contract_ai_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  if exists (
    select 1
    from public.contract_ai_jobs as job
    where job.contract_id = p_contract_id
      and (
        job.status <> 'queued'
        or job.attempts <> 0
        or job.started_at is not null
        or job.lease_expires_at is not null
      )
  ) then
    return false;
  end if;

  select * into uploaded_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;
  if uploaded_contract.id is null
    or uploaded_contract.org_id is distinct from p_org_id
    or uploaded_contract.rights_holder_id is distinct from p_rights_holder_id
    or uploaded_contract.created_by is distinct from p_owner_id
    or uploaded_contract.pdf_url is distinct from p_storage_path
    or uploaded_contract.status is distinct from 'kladde' then
    return false;
  end if;

  delete from public.contracts where id = uploaded_contract.id;
  if not found then return false; end if;

  update public.contract_upload_intents
  set contract_id = null,
      expires_at = least(expires_at, now()),
      expired_object_cleanup_at = null,
      cleanup_status = 'pending',
      cleanup_claimed_at = null,
      cleanup_claim_token = null,
      cleanup_claim_kind = null,
      finalization_status = 'rolled_back',
      finalization_token = null,
      finalized_at = null
  where id = upload_intent.id
    and contract_id is null
    and finalization_status = 'processing'
    and finalization_token = p_finalization_token;
  if not found then
    raise exception 'upload rollback lease lost' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function public.rollback_member_uploaded_contract(
  uuid, uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.rollback_member_uploaded_contract(
  uuid, uuid, uuid, uuid, uuid, text, uuid
) to service_role;

create or replace function public.queue_or_retry_member_contract_document_job(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_contract_id uuid
)
returns table(outcome text, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisional_contract public.contracts;
  locked_contract public.contracts;
  selected_job public.contract_document_jobs;
  created_job_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_contract_id is null then
    raise exception 'invalid document retry identity' using errcode = '22023';
  end if;

  select contract.* into provisional_contract
  from public.contracts as contract
  where contract.id = p_contract_id;
  if provisional_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if provisional_contract.org_id <> p_org_id
    or provisional_contract.rights_holder_id is distinct from p_rights_holder_id
    or provisional_contract.status <> 'kladde'
    or nullif(provisional_contract.pdf_url, '') is null
    or lower(provisional_contract.pdf_url) !~ '[.](pdf|doc|docx)$'
    or not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = p_org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = p_rights_holder_id
        and holder.user_id = p_owner_id
        and holder.archived_at is null
    ) then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;

  select job.* into selected_job
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id
  order by
    case when job.status in ('queued', 'processing')
      or (job.status = 'failed' and job.attempts < 5) then 0 else 1 end,
    job.created_at desc,
    job.id desc
  limit 1
  for update of job;

  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update of contract;
  if locked_contract.id is null
    or locked_contract.org_id <> p_org_id
    or locked_contract.rights_holder_id is distinct from p_rights_holder_id
    or locked_contract.status <> 'kladde'
    or nullif(locked_contract.pdf_url, '') is null
    or lower(locked_contract.pdf_url) !~ '[.](pdf|doc|docx)$'
    or not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = p_org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = p_rights_holder_id
        and holder.user_id = p_owner_id
        and holder.archived_at is null
    ) then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;

  if selected_job.id is null then
    created_job_id := gen_random_uuid();
    insert into public.contract_document_jobs (
      id, contract_id, org_id, created_by, original_storage_path,
      output_storage_path, status, priority, attempts, next_attempt_at,
      downstream_ai_policy
    ) values (
      created_job_id, p_contract_id, p_org_id, p_owner_id,
      locked_contract.pdf_url,
      p_org_id::text || '/processed/' || p_contract_id::text
        || '/pending/' || created_job_id::text || '/normalised.pdf',
      'queued', 100, 0, now(), 'reanalyze'
    )
    on conflict do nothing;
    if not found then
      select job.* into selected_job
      from public.contract_document_jobs as job
      where job.contract_id = p_contract_id
        and (
          job.status in ('queued', 'processing')
          or (job.status = 'failed' and job.attempts < 5)
        )
      order by job.created_at desc, job.id desc
      limit 1;
      if selected_job.id is null then
        raise exception 'document retry race could not be resolved' using errcode = '55000';
      end if;
      return query select 'already_queued'::text, selected_job.id;
      return;
    end if;
    update public.contracts
    set document_processing_status = 'pending', document_processing_error_code = null
    where id = p_contract_id;
    return query select 'queued'::text, created_job_id;
    return;
  end if;

  if selected_job.org_id <> p_org_id
    or selected_job.original_storage_path is distinct from locked_contract.pdf_url then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;
  if selected_job.status in ('queued', 'processing')
    or (selected_job.status = 'failed' and selected_job.attempts < 5) then
    return query select 'already_queued'::text, selected_job.id;
    return;
  end if;
  if selected_job.status in ('completed', 'not_required') then
    return query select 'already_processed'::text, selected_job.id;
    return;
  end if;
  if selected_job.status not in ('needs_review', 'failed')
    or (selected_job.status = 'failed' and selected_job.attempts < 5) then
    raise exception 'document job cannot be retried' using errcode = '55000';
  end if;
  if selected_job.review_disposition = 'rescan_requested' then
    raise exception 'document requires a better source scan' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as newer
    where newer.contract_id = selected_job.contract_id
      and newer.id <> selected_job.id
      and (
        newer.created_at > selected_job.created_at
        or (newer.created_at = selected_job.created_at and newer.id::text > selected_job.id::text)
      )
  ) then
    raise exception 'newer document generation exists' using errcode = '55000';
  end if;

  created_job_id := gen_random_uuid();
  insert into public.contract_document_jobs (
    id, contract_id, org_id, created_by, original_storage_path,
    output_storage_path, status, priority, attempts, next_attempt_at,
    original_sha256, recovery_of_job_id, downstream_ai_policy,
    recovery_reason_code
  ) values (
    created_job_id, selected_job.contract_id, selected_job.org_id, p_owner_id,
    selected_job.original_storage_path,
    p_org_id::text || '/processed/' || p_contract_id::text
      || '/pending/' || created_job_id::text || '/normalised.pdf',
    'queued', greatest(selected_job.priority, 100), 0, now(),
    selected_job.original_sha256, selected_job.id, 'reanalyze', 'member_retry'
  );

  update public.contract_document_jobs
  set review_disposition = 'retry_after_pipeline_fix',
      reviewed_at = now(), reviewed_by = p_owner_id, updated_at = now()
  where id = selected_job.id;
  update public.contracts
  set document_processing_status = 'pending', document_processing_error_code = null
  where id = p_contract_id;
  return query select 'requeued'::text, created_job_id;
end;
$$;

revoke all on function public.queue_or_retry_member_contract_document_job(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.queue_or_retry_member_contract_document_job(
  uuid, uuid, uuid, uuid
) to service_role;

-- The service-role navigation RPC bypasses table RLS. Bind member message
-- badges to the stable comment participant, not to the contract's current
-- owner, so an ownership correction cannot transfer conversation metadata.
create or replace function public.get_navigation_badge_counts(
  p_org_id uuid,
  p_user_id uuid,
  p_rights_holder_id uuid default null
)
returns table (
  admin_contracts bigint,
  admin_contract_messages bigint,
  admin_works bigint,
  admin_work_messages bigint,
  admin_reviews bigint,
  admin_screenings bigint,
  member_work_messages bigint,
  member_work_review_todos bigint,
  member_contract_messages bigint,
  member_inbox_messages bigint
)
language sql stable security invoker set search_path = ''
as $$
  with member_review_groups as (
    select 'season:' || scope.series_work_id::text || ':' || scope.season_number::text as group_key
    from public.member_series_episode_scopes scope
    where p_rights_holder_id is not null and scope.org_id = p_org_id and scope.rights_holder_id = p_rights_holder_id and scope.status = 'pending'
    union
    select case when work.parent_work_id is not null and work.season_number is not null then 'season:' || work.parent_work_id::text || ':' || work.season_number::text else 'work:' || review.work_id::text end
    from public.member_work_collaboration_reviews review join public.works work on work.id = review.work_id
    where p_rights_holder_id is not null and review.org_id = p_org_id and review.rights_holder_id = p_rights_holder_id and review.status = 'pending'
  ), actionable_share_cases as (
    select share_case.*
    from public.work_share_cases share_case
    where share_case.org_id = p_org_id
      and share_case.status <> 'resolved'
      and (
        (select count(*) from public.work_share_participants participant where participant.case_id = share_case.id and participant.excluded_at is null) > 1
        or exists (
          select 1
          from public.work_share_participants participant
          where participant.case_id = share_case.id
            and participant.excluded_at is null
            and (
              participant.rights_holder_id is null
              or participant.invited_by_rights_holder_id is not null
              or (
                not ('local' = any(participant.source_tags))
                and (('dfi' = any(participant.source_tags)) or ('tmdb' = any(participant.source_tags)))
              )
            )
        )
      )
  ), admin_work_groups as (
    select 'request:' || request.id::text as group_key from public.work_change_requests request where request.org_id = p_org_id and request.status = 'pending'
    union
    select 'share:' || share_case.work_id::text || ':' || coalesce(share_case.season_number, 0)::text || ':' || coalesce(share_case.episode_number, 0)::text
    from actionable_share_cases share_case
    union
    select 'share:' || review.work_id::text || ':' || coalesce(work.season_number, 0)::text || ':' || coalesce(work.episode_number, 0)::text
    from public.member_work_collaboration_reviews review
    join public.works work on work.id = review.work_id
    where review.org_id = p_org_id and review.status = 'disputed'
  )
  select
    (select count(*) from public.contracts contract where contract.org_id = p_org_id and contract.status = 'kladde'),
    (select count(*) from public.contract_comments comment where comment.org_id = p_org_id and comment.author_role = 'member' and comment.admin_read_at is null),
    (select count(*) from admin_work_groups),
    (select count(*) from public.work_change_request_comments comment join public.work_change_requests request on request.id = comment.request_id where request.org_id = p_org_id and comment.author_role = 'member' and comment.admin_read_at is null),
    (select count(*) from public.contract_reviews review where review.org_id = p_org_id and review.status in ('afventer', 'behandling')),
    (select count(*) from public.screening_claims claim where claim.org_id = p_org_id and claim.status = 'pending'),
    (select count(*) from public.work_change_request_comments comment join public.work_change_requests request on request.id = comment.request_id where request.org_id = p_org_id and request.requested_by_user_id = p_user_id and comment.author_role = 'admin' and comment.member_read_at is null),
    (select count(*) from member_review_groups) + (
      select count(*)
      from public.work_share_participants participant
      join actionable_share_cases share_case on share_case.id = participant.case_id
      where p_rights_holder_id is not null
        and participant.org_id = p_org_id
        and participant.rights_holder_id = p_rights_holder_id
        and participant.relationship_status = 'pending'
        and participant.excluded_at is null
    ),
    (select count(*) from public.contract_comments comment where p_rights_holder_id is not null and comment.org_id = p_org_id and comment.member_rights_holder_id = p_rights_holder_id and comment.author_role = 'admin' and comment.member_read_at is null),
    (select count(*) from public.member_message_participants participant join public.member_message_threads thread on thread.id = participant.thread_id join public.member_messages message on message.thread_id = thread.id where participant.user_id = p_user_id and thread.org_id = p_org_id and message.author_role = 'admin' and message.created_at > coalesce(participant.last_read_at, '-infinity'::timestamptz));
$$;

revoke all on function public.get_navigation_badge_counts(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_navigation_badge_counts(uuid, uuid, uuid) to service_role;

-- Same participant binding for the member dashboard's unread count and
-- previews. The contract join remains only for the title/current-version
-- filter and is not used to infer the conversation participant.
create or replace function public.get_member_dashboard_task_overview(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_user_id uuid,
  p_preview_limit integer default 5
)
returns table (
  works_missing_contract_count bigint,
  contracts_missing_work_count bigint,
  review_work_count bigint,
  share_task_count bigint,
  unread_contract_count bigint,
  pending_work_request_count bigint,
  pending_screening_count bigint,
  share_tasks jsonb,
  unread_contracts jsonb,
  pending_work_requests jsonb,
  pending_screenings jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  missing_contract_works as (
    select distinct assignment.work_id
    from public.work_assignments assignment
    where assignment.org_id = p_org_id
      and assignment.rights_holder_id = p_rights_holder_id
      and assignment.work_id is not null
      and not exists (
        select 1
        from public.contracts contract
        where contract.org_id = p_org_id
          and contract.rights_holder_id = p_rights_holder_id
          and contract.superseded_by_contract_id is null
          and contract.work_id = assignment.work_id
      )
  ),
  missing_work_contracts as (
    select contract.id
    from public.contracts contract
    where contract.org_id = p_org_id
      and contract.rights_holder_id = p_rights_holder_id
      and contract.superseded_by_contract_id is null
      and contract.work_id is null
  ),
  review_groups as (
    select 'season:' || scope.series_work_id::text || ':' || scope.season_number::text as group_key
    from public.member_series_episode_scopes scope
    where scope.org_id = p_org_id
      and scope.rights_holder_id = p_rights_holder_id
      and scope.status = 'pending'
    union
    select case
      when work.parent_work_id is not null and work.season_number is not null
        then 'season:' || work.parent_work_id::text || ':' || work.season_number::text
      else 'work:' || review.work_id::text
    end
    from public.member_work_collaboration_reviews review
    join public.works work on work.id = review.work_id
    where review.org_id = p_org_id
      and review.rights_holder_id = p_rights_holder_id
      and review.status = 'pending'
  ),
  member_share_tasks as (
    select participant.id, participant.case_id, work.title, participant.created_at
    from public.work_share_participants participant
    join public.work_share_cases share_case on share_case.id = participant.case_id
    join public.works work on work.id = participant.work_id
    where participant.org_id = p_org_id
      and participant.rights_holder_id = p_rights_holder_id
      and participant.relationship_status = 'pending'
      and participant.excluded_at is null
      and share_case.status <> 'resolved'
  ),
  unread_member_contracts as (
    select contract.id, contract.working_title, max(comment.created_at) as latest_at
    from public.contracts contract
    join public.contract_comments comment on comment.contract_id = contract.id
    where contract.org_id = p_org_id
      and comment.member_rights_holder_id = p_rights_holder_id
      and contract.superseded_by_contract_id is null
      and comment.author_role = 'admin'
      and comment.member_read_at is null
    group by contract.id, contract.working_title
  ),
  member_work_requests as (
    select request.id, request.created_at
    from public.work_change_requests request
    where request.org_id = p_org_id
      and request.requested_by_rights_holder_id = p_rights_holder_id
      and request.status = 'pending'
  ),
  member_screenings as (
    select claim.id, claim.title, claim.created_at
    from public.screening_claims claim
    where claim.org_id = p_org_id
      and claim.profile_id = p_user_id
      and claim.status = 'pending'
  )
  select
    (select count(*) from missing_contract_works),
    (select count(*) from missing_work_contracts),
    (select count(*) from review_groups),
    (select count(*) from member_share_tasks),
    (select count(*) from unread_member_contracts),
    (select count(*) from member_work_requests),
    (select count(*) from member_screenings),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', preview.id,
        'caseId', preview.case_id,
        'title', preview.title
      ) order by preview.created_at desc)
      from (
        select * from member_share_tasks
        order by created_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'contractId', preview.id,
        'title', preview.working_title
      ) order by preview.latest_at desc)
      from (
        select * from unread_member_contracts
        order by latest_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', preview.id) order by preview.created_at desc)
      from (
        select * from member_work_requests
        order by created_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', preview.id,
        'title', preview.title
      ) order by preview.created_at desc)
      from (
        select * from member_screenings
        order by created_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb);
$$;

revoke all on function public.get_member_dashboard_task_overview(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_member_dashboard_task_overview(uuid, uuid, uuid, integer)
  to service_role;
