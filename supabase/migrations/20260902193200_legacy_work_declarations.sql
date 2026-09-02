-- Organisationsstyret dokumentationsundtagelse for aeldre vaerker.
-- Browserroller har ingen direkte skriveadgang. Medlemsaccept og
-- ugyldiggoerelse sker gennem server-only RPC'er, som ogsaa skriver audit i
-- samme databasetransaktion.

alter table public.organisations
  add column if not exists legacy_contract_declaration_enabled boolean not null default false,
  add column if not exists legacy_contract_cutoff_year integer;

alter table public.organisations
  drop constraint if exists organisations_legacy_contract_cutoff_year_check;
alter table public.organisations
  add constraint organisations_legacy_contract_cutoff_year_check check (
    legacy_contract_cutoff_year is null
    or legacy_contract_cutoff_year between 1888 and 2200
  );

alter table public.organisations
  drop constraint if exists organisations_legacy_contract_declaration_config_check;
alter table public.organisations
  add constraint organisations_legacy_contract_declaration_config_check check (
    not legacy_contract_declaration_enabled or legacy_contract_cutoff_year is not null
  );

alter table public.works
  add column if not exists production_year integer;

alter table public.works
  drop constraint if exists works_production_year_check;
alter table public.works
  add constraint works_production_year_check check (
    production_year is null or production_year between 1888 and 2200
  );

comment on column public.works.production_year is
  'Verificeret produktionsaar. Kontraktdato maa aldrig kopieres hertil.';

alter table public.legal_document_versions
  drop constraint if exists legal_document_versions_type_check;
alter table public.legal_document_versions
  add constraint legal_document_versions_type_check check (document_type in (
    'privacy_notice',
    'terms_of_service',
    'ai_transparency_notice',
    'contract_analysis_notice',
    'legacy_work_declaration'
  ));

alter table public.legal_document_acceptances
  drop constraint if exists legal_document_acceptances_type_check;
alter table public.legal_document_acceptances
  add constraint legal_document_acceptances_type_check check (document_type in (
    'privacy_notice',
    'terms_of_service',
    'ai_transparency_notice',
    'contract_analysis_notice',
    'legacy_work_declaration'
  ));

with default_document(audience, title, body) as (
  values
    ('member', 'Tro-og-loveerklæring om arbejde på produktioner',
     'Jeg erklærer på tro og love, at jeg personligt har arbejdet som {faggruppe} på de produktioner, jeg har valgt nedenfor, og at oplysningerne om min kreditering og deltagelse er korrekte.\n\nFor produktioner før {skæringsår} kræver Copydan ikke, at dokumentationen for rettighedshaverens tilknytning nødvendigvis består af en kontrakt. {organisation} anvender derfor denne erklæring som dokumentation i behandlingen og den eventuelle fordeling af rettighedsmidler.\n\nJeg er bekendt med, at {organisation} kan bede om supplerende dokumentation. Jeg forpligter mig til straks at rette oplysningerne, hvis de viser sig at være forkerte. Urigtige oplysninger kan medføre, at en udbetaling tilbageholdes, korrigeres eller kræves tilbagebetalt.'),
    ('non_member', 'Tro-og-loveerklæring om arbejde på produktioner',
     'Jeg erklærer på tro og love, at jeg personligt har arbejdet som {faggruppe} på de produktioner, jeg har valgt nedenfor, og at oplysningerne om min kreditering og deltagelse er korrekte.\n\nFor produktioner før {skæringsår} kræver Copydan ikke, at dokumentationen for rettighedshaverens tilknytning nødvendigvis består af en kontrakt. {organisation} anvender derfor denne erklæring som dokumentation i behandlingen og den eventuelle fordeling af rettighedsmidler.\n\nJeg er bekendt med, at {organisation} kan bede om supplerende dokumentation. Jeg forpligter mig til straks at rette oplysningerne, hvis de viser sig at være forkerte. Urigtige oplysninger kan medføre, at en udbetaling tilbageholdes, korrigeres eller kræves tilbagebetalt.')
)
insert into public.legal_document_versions (
  org_id, document_type, audience, version, status, title, body,
  content_hash, published_at
)
select
  organisation.id,
  'legacy_work_declaration',
  default_document.audience,
  1,
  'published',
  default_document.title,
  default_document.body,
  encode(extensions.digest(default_document.body, 'sha256'), 'hex'),
  now()
from public.organisations organisation
cross join default_document
where not exists (
  select 1
  from public.legal_document_versions existing
  where existing.org_id = organisation.id
    and existing.document_type = 'legacy_work_declaration'
    and existing.audience = default_document.audience
);

create table if not exists public.legacy_work_declarations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete restrict,
  accepted_by_user_id uuid not null references auth.users(id) on delete restrict,
  root_work_id uuid not null references public.works(id) on delete restrict,
  qualifying_scope_ids_snapshot uuid[] not null,
  document_version_id uuid not null references public.legal_document_versions(id) on delete restrict,
  document_version integer not null,
  content_hash text not null,
  work_title_snapshot text not null,
  role_snapshot text not null,
  premiere_year_snapshot integer,
  production_year_snapshot integer,
  cutoff_year_snapshot integer not null,
  batch_id uuid not null,
  accepted_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidated_by_user_id uuid references auth.users(id) on delete restrict,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  constraint legacy_work_declarations_version_check check (document_version > 0),
  constraint legacy_work_declarations_scopes_check check (cardinality(qualifying_scope_ids_snapshot) > 0),
  constraint legacy_work_declarations_cutoff_check check (cutoff_year_snapshot between 1888 and 2200),
  constraint legacy_work_declarations_invalidation_check check (
    (invalidated_at is null and invalidated_by_user_id is null and invalidation_reason is null)
    or
    (invalidated_at is not null and invalidated_by_user_id is not null and length(trim(invalidation_reason)) between 3 and 1000)
  )
);

create unique index if not exists legacy_work_declarations_active_unique
  on public.legacy_work_declarations(org_id, rights_holder_id, root_work_id)
  where invalidated_at is null;
create index if not exists legacy_work_declarations_holder_idx
  on public.legacy_work_declarations(org_id, rights_holder_id, accepted_at desc);
create index if not exists legacy_work_declarations_work_idx
  on public.legacy_work_declarations(org_id, root_work_id, accepted_at desc);
create index if not exists works_org_production_year_idx
  on public.works(org_id, production_year, id)
  where production_year is not null;

alter table public.legacy_work_declarations enable row level security;
revoke all on public.legacy_work_declarations from public, anon, authenticated;
grant select, insert on public.legacy_work_declarations to service_role;

comment on table public.legacy_work_declarations is
  'Append-only accepter pr. titel. Ugyldiggoerelse bevarer den oprindelige accept og dens snapshots.';

create or replace function public.list_member_legacy_declaration_tasks(
  p_org_id uuid,
  p_rights_holder_id uuid
)
returns table (
  root_work_id uuid,
  title text,
  role text,
  premiere_year integer,
  production_year integer,
  qualifying_scope_count bigint,
  qualifying_scope_ids uuid[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with config as (
    select organisation.legacy_contract_cutoff_year as cutoff_year
    from public.organisations organisation
    where organisation.id = p_org_id
      and organisation.legacy_contract_declaration_enabled
      and organisation.legacy_contract_cutoff_year is not null
  ),
  eligible_assignments as (
    select
      assignment.id,
      assignment.work_id,
      assignment.role,
      work.parent_work_id,
      coalesce(work.parent_work_id, work.id) as root_work_id,
      work.season_number,
      work.year,
      work.production_year,
      work.type
    from public.work_assignments assignment
    join public.works work on work.id = assignment.work_id
    cross join config
    where assignment.org_id = p_org_id
      and assignment.rights_holder_id = p_rights_holder_id
      and (
        work.parent_work_id is not null
        or lower(coalesce(work.type, '')) not in ('tv-serie', 'dokumentar-serie', 'serie', 'tv-program', 'reality', 'sport')
      )
      and (
        (work.year is not null and work.year < config.cutoff_year)
        or (work.production_year is not null and work.production_year < config.cutoff_year)
      )
      and not exists (
        select 1
        from public.contracts contract
        where contract.org_id = p_org_id
          and contract.rights_holder_id = p_rights_holder_id
          and contract.superseded_by_contract_id is null
          and (
            contract.work_id = work.id
            or (
              contract.work_id = coalesce(work.parent_work_id, work.id)
              and (
                work.parent_work_id is null
                or contract.season_number is null
                or contract.season_number = work.season_number
              )
            )
          )
      )
  )
  select
    eligible.root_work_id,
    root.title,
    coalesce(min(nullif(trim(eligible.role), '')), 'Klipper') as role,
    min(eligible.year) as premiere_year,
    min(eligible.production_year) as production_year,
    count(distinct eligible.work_id) as qualifying_scope_count,
    array_agg(distinct eligible.work_id order by eligible.work_id) as qualifying_scope_ids
  from eligible_assignments eligible
  join public.works root on root.id = eligible.root_work_id and root.org_id = p_org_id
  where not exists (
    select 1
    from public.legacy_work_declarations declaration
    where declaration.org_id = p_org_id
      and declaration.rights_holder_id = p_rights_holder_id
      and declaration.root_work_id = eligible.root_work_id
      and declaration.invalidated_at is null
  )
  group by eligible.root_work_id, root.title
  order by root.title, eligible.root_work_id;
$$;

revoke all on function public.list_member_legacy_declaration_tasks(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_member_legacy_declaration_tasks(uuid, uuid)
  to service_role;

create or replace function public.count_member_contract_required_works(
  p_org_id uuid,
  p_rights_holder_id uuid
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  with assigned as (
    select distinct
      assignment.work_id,
      coalesce(work.parent_work_id, work.id) as root_work_id,
      work.parent_work_id,
      work.season_number,
      work.type,
      work.year,
      work.production_year
    from public.work_assignments assignment
    join public.works work on work.id = assignment.work_id
    where assignment.org_id = p_org_id
      and assignment.rights_holder_id = p_rights_holder_id
  ),
  config as (
    select legacy_contract_declaration_enabled as enabled,
           legacy_contract_cutoff_year as cutoff_year
    from public.organisations where id = p_org_id
  )
  select count(distinct assigned.root_work_id)
  from assigned cross join config
  where not exists (
    select 1 from public.contracts contract
    where contract.org_id = p_org_id
      and contract.rights_holder_id = p_rights_holder_id
      and contract.superseded_by_contract_id is null
      and (
        contract.work_id = assigned.work_id
        or (contract.work_id = assigned.root_work_id and (
          assigned.parent_work_id is null
          or contract.season_number is null
          or contract.season_number = assigned.season_number
        ))
      )
  )
  and not (
    config.enabled
    and config.cutoff_year is not null
    and (
      assigned.parent_work_id is not null
      or lower(coalesce(assigned.type, '')) not in ('tv-serie', 'dokumentar-serie', 'serie', 'tv-program', 'reality', 'sport')
    )
    and (
      (assigned.year is not null and assigned.year < config.cutoff_year)
      or (assigned.production_year is not null and assigned.production_year < config.cutoff_year)
    )
  );
$$;

revoke all on function public.count_member_contract_required_works(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.count_member_contract_required_works(uuid, uuid)
  to service_role;

create or replace function public.accept_member_legacy_declarations(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_actor_user_id uuid,
  p_root_work_ids uuid[],
  p_batch_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_count integer;
  inserted_count integer;
  cutoff_year integer;
  audience_name text;
  document_row public.legal_document_versions%rowtype;
begin
  if p_actor_user_id is null or p_batch_id is null or cardinality(p_root_work_ids) < 1
     or cardinality(p_root_work_ids) > 500 then
    raise exception 'Invalid declaration request';
  end if;

  if not exists (
    select 1 from public.rettighedshavere holder
    join public.org_affiliations affiliation on affiliation.rights_holder_id = holder.id
    where holder.id = p_rights_holder_id
      and holder.user_id = p_actor_user_id
      and affiliation.org_id = p_org_id
  ) then
    raise exception 'Declaration access denied';
  end if;

  select organisation.legacy_contract_cutoff_year
  into cutoff_year
  from public.organisations organisation
  where organisation.id = p_org_id
    and organisation.legacy_contract_declaration_enabled;
  if cutoff_year is null then raise exception 'Legacy declaration is disabled'; end if;

  select case when affiliation.is_member then 'member' else 'non_member' end
  into audience_name
  from public.org_affiliations affiliation
  where affiliation.org_id = p_org_id
    and affiliation.rights_holder_id = p_rights_holder_id
  limit 1;

  select version.* into document_row
  from public.legal_document_versions version
  where version.org_id = p_org_id
    and version.document_type = 'legacy_work_declaration'
    and version.audience = audience_name
    and version.status = 'published'
  order by version.version desc
  limit 1;
  if document_row.id is null then raise exception 'Declaration text is not published'; end if;

  select count(*) into selected_count
  from unnest(p_root_work_ids) selected(root_work_id);
  if selected_count <> (select count(distinct selected.root_work_id) from unnest(p_root_work_ids) selected(root_work_id)) then
    raise exception 'Duplicate work in declaration request';
  end if;
  if selected_count <> (
    select count(*)
    from public.list_member_legacy_declaration_tasks(p_org_id, p_rights_holder_id) task
    where task.root_work_id = any(p_root_work_ids)
  ) then
    raise exception 'One or more works no longer qualify';
  end if;

  insert into public.legacy_work_declarations (
    org_id, rights_holder_id, accepted_by_user_id, root_work_id,
    qualifying_scope_ids_snapshot,
    document_version_id, document_version, content_hash,
    work_title_snapshot, role_snapshot, premiere_year_snapshot,
    production_year_snapshot, cutoff_year_snapshot, batch_id
  )
  select
    p_org_id, p_rights_holder_id, p_actor_user_id, task.root_work_id,
    task.qualifying_scope_ids,
    document_row.id, document_row.version, document_row.content_hash,
    task.title, task.role, task.premiere_year, task.production_year,
    cutoff_year, p_batch_id
  from public.list_member_legacy_declaration_tasks(p_org_id, p_rights_holder_id) task
  where task.root_work_id = any(p_root_work_ids);
  get diagnostics inserted_count = row_count;

  perform public.append_audit_event_v2(
    p_action => 'approve',
    p_entity_type => 'legacy_work_declaration_batch',
    p_entity_id => p_batch_id::text,
    p_entity_label => 'Tro-og-loveerklæring',
    p_actor_user_id => p_actor_user_id,
    p_actor_role => 'member',
    p_actor_type => 'user',
    p_actor_org_id => p_org_id,
    p_source => 'portal',
    p_correlation_id => p_batch_id,
    p_metadata => jsonb_build_object('declaration_count', inserted_count),
    p_target_member_uuid => p_rights_holder_id,
    p_target_member_uuids => array[p_rights_holder_id],
    p_purpose_code => 'legacy_work_documentation',
    p_legal_basis => 'member_declaration',
    p_data_categories => array['work_data', 'rights_data'],
    p_system_component => 'portal.legacy_work_declaration',
    p_org_ids => array[p_org_id]
  );
  return inserted_count;
end;
$$;

revoke all on function public.accept_member_legacy_declarations(uuid, uuid, uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.accept_member_legacy_declarations(uuid, uuid, uuid, uuid[], uuid)
  to service_role;

create or replace function public.list_member_legacy_declared_scope_ids(
  p_org_id uuid,
  p_rights_holder_id uuid
)
returns table (work_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct assignment.work_id
  from public.work_assignments assignment
  join public.works work on work.id = assignment.work_id
  join public.organisations organisation on organisation.id = p_org_id
  join public.legacy_work_declarations declaration
    on declaration.org_id = p_org_id
   and declaration.rights_holder_id = p_rights_holder_id
   and declaration.root_work_id = coalesce(work.parent_work_id, work.id)
   and declaration.invalidated_at is null
  where assignment.org_id = p_org_id
    and assignment.rights_holder_id = p_rights_holder_id
    and organisation.legacy_contract_declaration_enabled
    and organisation.legacy_contract_cutoff_year is not null
    and (
      work.parent_work_id is not null
      or lower(coalesce(work.type, '')) not in ('tv-serie', 'dokumentar-serie', 'serie', 'tv-program', 'reality', 'sport')
    )
    and (
      (work.year is not null and work.year < organisation.legacy_contract_cutoff_year)
      or (work.production_year is not null and work.production_year < organisation.legacy_contract_cutoff_year)
    )
    and not exists (
      select 1 from public.contracts contract
      where contract.org_id = p_org_id
        and contract.rights_holder_id = p_rights_holder_id
        and contract.superseded_by_contract_id is null
        and (
          contract.work_id = work.id
          or (contract.work_id = coalesce(work.parent_work_id, work.id) and (
            work.parent_work_id is null
            or contract.season_number is null
            or contract.season_number = work.season_number
          ))
        )
    );
$$;

revoke all on function public.list_member_legacy_declared_scope_ids(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_member_legacy_declared_scope_ids(uuid, uuid)
  to service_role;

create or replace function public.reject_member_legacy_declaration_task(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_actor_user_id uuid,
  p_root_work_id uuid,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
  work_title text;
begin
  if not exists (
    select 1 from public.rettighedshavere holder
    join public.org_affiliations affiliation on affiliation.rights_holder_id = holder.id
    where holder.id = p_rights_holder_id
      and holder.user_id = p_actor_user_id
      and affiliation.org_id = p_org_id
  ) then raise exception 'Declaration access denied'; end if;

  select task.title into work_title
  from public.list_member_legacy_declaration_tasks(p_org_id, p_rights_holder_id) task
  where task.root_work_id = p_root_work_id;
  if work_title is null then raise exception 'Work no longer qualifies'; end if;

  select request.id into request_id
  from public.work_change_requests request
  where request.org_id = p_org_id
    and request.work_id = p_root_work_id
    and request.requested_by_rights_holder_id = p_rights_holder_id
    and request.source = 'legacy_declaration_denial'
    and request.status = 'pending'
  limit 1;

  if request_id is null then
    insert into public.work_change_requests (
      org_id, work_id, requested_by_user_id, requested_by_rights_holder_id,
      source, old_data, proposed_data, status
    ) values (
      p_org_id, p_root_work_id, p_actor_user_id, p_rights_holder_id,
      'legacy_declaration_denial', '{}'::jsonb,
      jsonb_build_object('relationship_disputed', true), 'pending'
    ) returning id into request_id;
  end if;

  perform public.append_audit_event_v2(
    p_action => 'reject', p_entity_type => 'legacy_work_declaration_task',
    p_entity_id => p_root_work_id::text, p_entity_label => work_title,
    p_actor_user_id => p_actor_user_id, p_actor_role => 'member',
    p_actor_type => 'user', p_actor_org_id => p_org_id, p_source => 'portal',
    p_correlation_id => p_correlation_id,
    p_metadata => jsonb_build_object('review_request_created', true),
    p_target_member_uuid => p_rights_holder_id,
    p_target_member_uuids => array[p_rights_holder_id],
    p_purpose_code => 'legacy_work_documentation', p_legal_basis => 'member_declaration',
    p_data_categories => array['work_data', 'rights_data'],
    p_system_component => 'portal.legacy_work_declaration',
    p_org_ids => array[p_org_id]
  );
  return request_id;
end;
$$;

revoke all on function public.reject_member_legacy_declaration_task(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reject_member_legacy_declaration_task(uuid, uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.invalidate_legacy_work_declaration(
  p_org_id uuid,
  p_declaration_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  declaration_row public.legacy_work_declarations%rowtype;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Invalidation reason is required';
  end if;
  select * into declaration_row
  from public.legacy_work_declarations declaration
  where declaration.id = p_declaration_id
    and declaration.org_id = p_org_id
    and declaration.invalidated_at is null
  for update;
  if declaration_row.id is null then raise exception 'Declaration not found'; end if;

  update public.legacy_work_declarations
  set invalidated_at = now(), invalidated_by_user_id = p_actor_user_id,
      invalidation_reason = left(trim(p_reason), 1000)
  where id = p_declaration_id;

  perform public.append_audit_event_v2(
    p_action => 'invalidate', p_entity_type => 'legacy_work_declaration',
    p_entity_id => p_declaration_id::text,
    p_entity_label => declaration_row.work_title_snapshot,
    p_actor_user_id => p_actor_user_id, p_actor_role => 'admin',
    p_actor_type => 'user', p_actor_org_id => p_org_id, p_source => 'admin',
    p_correlation_id => p_correlation_id,
    p_changes => jsonb_build_array(jsonb_build_object('field', 'status', 'old', 'active', 'new', 'invalidated')),
    p_metadata => jsonb_build_object('reason_recorded', true),
    p_target_member_uuid => declaration_row.rights_holder_id,
    p_target_member_uuids => array[declaration_row.rights_holder_id],
    p_purpose_code => 'legacy_work_documentation', p_legal_basis => 'administrative_review',
    p_data_categories => array['work_data', 'rights_data'],
    p_system_component => 'admin.legacy_work_declaration',
    p_org_ids => array[p_org_id]
  );
  return true;
end;
$$;

revoke all on function public.invalidate_legacy_work_declaration(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.invalidate_legacy_work_declaration(uuid, uuid, uuid, text, uuid)
  to service_role;
