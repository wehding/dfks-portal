alter table public.organisations
  add column if not exists member_work_invite_subject text,
  add column if not exists member_work_invite_text text,
  add column if not exists non_member_work_invite_subject text,
  add column if not exists non_member_work_invite_text text;

comment on column public.organisations.member_work_invite_text is
  'Redigerbar invitation til medlemmer med vaerksliste. Pladsholdere: {navn}, {vaerk}, {vaerker}, {organisation}.';
comment on column public.organisations.non_member_work_invite_text is
  'Redigerbar invitation til ikke-medlemmer med vaerksliste. Pladsholdere: {navn}, {vaerk}, {vaerker}, {organisation}.';

alter table public.work_share_participants
  add column if not exists source_tags text[] not null default '{}'::text[],
  add column if not exists source_details jsonb not null default '{}'::jsonb,
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists last_reminder_sent_at timestamptz,
  add column if not exists reminder_count integer not null default 0;

alter table public.work_share_participants
  add constraint work_share_participants_source_tags_check
  check (source_tags <@ array['local','member','dfi','tmdb']::text[]),
  add constraint work_share_participants_reminder_count_check
  check (reminder_count >= 0);

create table if not exists public.work_credit_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  source text not null check (source in ('dfi','tmdb')),
  source_work_id text not null,
  external_person_id text not null default '',
  credited_name text not null check (length(trim(credited_name)) > 0),
  normalized_name text not null check (length(trim(normalized_name)) > 0),
  credited_role text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists work_credit_evidence_source_person_uidx
  on public.work_credit_evidence (
    org_id,
    work_id,
    source,
    source_work_id,
    external_person_id,
    normalized_name
  );
create index if not exists work_credit_evidence_work_idx
  on public.work_credit_evidence (org_id, work_id, fetched_at desc);

alter table public.work_credit_evidence enable row level security;
revoke all on public.work_credit_evidence from public, anon, authenticated;
grant all on public.work_credit_evidence to service_role;

comment on table public.work_credit_evidence is
  'Serverbeskyttet snapshot af klipperkrediteringer fra DFI og TMDb. Indeholder ingen kontaktoplysninger og fastsaetter aldrig arbejdsandele.';

create or replace function public.resolve_work_share_case(
  p_case_id uuid,
  p_org_id uuid,
  p_actor_user_id uuid,
  p_reserve_percent numeric,
  p_participants jsonb,
  p_allow_missing_responses boolean default false
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case public.work_share_cases%rowtype;
  v_row record;
  v_total numeric := coalesce(p_reserve_percent, 0);
  v_history jsonb;
  v_target_ids uuid[];
begin
  select * into v_case
  from public.work_share_cases
  where id = p_case_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Fordelingssagen findes ikke';
  end if;
  if p_reserve_percent < 0 or p_reserve_percent > 100 then
    raise exception 'Reserven skal vaere mellem 0 og 100';
  end if;
  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Deltagerlisten er ugyldig';
  end if;

  for v_row in
    select participant.id,
           participant.rights_holder_id,
           participant.role,
           participant.relationship_status,
           input.final_percent
    from public.work_share_participants participant
    left join lateral (
      select (entry->>'participantId')::uuid as participant_id,
             (entry->>'finalPercent')::numeric as final_percent
      from jsonb_array_elements(p_participants) entry
      where entry->>'participantId' = participant.id::text
      limit 1
    ) input on true
    where participant.case_id = p_case_id
      and participant.excluded_at is null
  loop
    if v_row.rights_holder_id is null then
      raise exception 'Alle relevante deltagere skal forbindes eller fravaelges';
    end if;
    if v_row.final_percent is null then
      raise exception 'Alle relevante deltagere skal have en endelig andel';
    end if;
    if not p_allow_missing_responses and v_row.relationship_status in ('pending','pending_match') then
      raise exception 'Der mangler medlemssvar';
    end if;
    if v_row.final_percent < 0 or v_row.final_percent > 100 then
      raise exception 'En andel ligger uden for intervallet 0-100';
    end if;
    v_total := v_total + v_row.final_percent;
  end loop;

  if abs(v_total - 100) > 0.001 then
    raise exception 'Andele og reserve skal tilsammen vaere 100 procent';
  end if;

  update public.work_share_participants participant
  set final_percent = (input.entry->>'finalPercent')::numeric,
      updated_at = now()
  from jsonb_array_elements(p_participants) input(entry)
  where participant.case_id = p_case_id
    and participant.id = (input.entry->>'participantId')::uuid
    and participant.excluded_at is null;

  if v_case.season_number is not null then
    select coalesce(array_agg(work.id order by work.id), array[v_case.work_id]) into v_target_ids
    from public.works work
    where work.parent_work_id = v_case.work_id
      and work.season_number = v_case.season_number
      and (
        v_case.episode_number is null or work.episode_number = v_case.episode_number
      )
      and (
        coalesce(cardinality(v_case.episode_numbers), 0) = 0
        or work.episode_number = any(v_case.episode_numbers)
      );
  else
    v_target_ids := array[v_case.work_id];
  end if;

  insert into public.work_assignments (org_id, work_id, rights_holder_id, role, share_percent)
  select p_org_id, target.work_id, participant.rights_holder_id,
         case when lower(trim(participant.role)) in ('medklipper','co-editor','coeditor') then 'Klipper' else participant.role end,
         participant.final_percent
  from public.work_share_participants participant
  cross join unnest(v_target_ids) target(work_id)
  where participant.case_id = p_case_id
    and participant.excluded_at is null
    and participant.rights_holder_id is not null
    and participant.final_percent is not null
  on conflict (work_id, rights_holder_id, role)
  do update set share_percent = excluded.share_percent;

  v_history := coalesce(v_case.resolution_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'resolvedAt', now(),
    'reservePercent', p_reserve_percent,
    'participants', p_participants,
    'allowMissingResponses', p_allow_missing_responses
  ));

  update public.work_share_cases
  set status = 'resolved',
      reserve_percent = p_reserve_percent,
      resolved_by_user_id = p_actor_user_id,
      resolved_at = now(),
      resolution_history = v_history,
      updated_at = now()
  where id = p_case_id and org_id = p_org_id;
end;
$$;

revoke all on function public.resolve_work_share_case(uuid, uuid, uuid, numeric, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.resolve_work_share_case(uuid, uuid, uuid, numeric, jsonb, boolean)
  to service_role;

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
  ), admin_work_groups as (
    select 'request:' || request.id::text as group_key from public.work_change_requests request where request.org_id = p_org_id and request.status = 'pending'
    union
    select 'share:' || share_case.work_id::text || ':' || coalesce(share_case.season_number, 0)::text || ':' || coalesce(share_case.episode_number, 0)::text
    from public.work_share_cases share_case where share_case.org_id = p_org_id and share_case.status <> 'resolved'
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
    (select count(*) from member_review_groups) + (select count(*) from public.work_share_participants participant where p_rights_holder_id is not null and participant.org_id = p_org_id and participant.rights_holder_id = p_rights_holder_id and participant.relationship_status = 'pending' and participant.excluded_at is null),
    (select count(*) from public.contract_comments comment join public.contracts contract on contract.id = comment.contract_id where p_rights_holder_id is not null and contract.org_id = p_org_id and contract.rights_holder_id = p_rights_holder_id and comment.author_role = 'admin' and comment.member_read_at is null),
    (select count(*) from public.member_message_participants participant join public.member_message_threads thread on thread.id = participant.thread_id join public.member_messages message on message.thread_id = thread.id where participant.user_id = p_user_id and thread.org_id = p_org_id and message.author_role = 'admin' and message.created_at > coalesce(participant.last_read_at, '-infinity'::timestamptz));
$$;

revoke all on function public.get_navigation_badge_counts(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_navigation_badge_counts(uuid, uuid, uuid) to service_role;

-- Juridisk gennemgang er fortsat påkrævet før publicering. Opret derfor
-- nye vilkår som kladder; den eksisterende publiceringshandling kræver ny
-- accept ved næste login.
with proposed_terms as (
  select organisation.id as org_id,
         audience.name as audience,
         E'Du er ansvarlig for, at de oplysninger, du indsender om værker, kontrakter, afsnit, medklippere og arbejdsandele, er korrekte og ajourførte. DFI, TMDb og AI-baserede udtræk er vejledende kilder. Organisationen foretager den endelige administrative vurdering og kan sætte en sag på pause, rette en registrering eller kræve tilbagebetaling ved fejl.\n\nHvis du for et bestemt udbetalingsår modtager rettighedspenge for et værk hos DFKS, er du ikke berettiget til samtidig at få udbetalt rettighedspenge for det samme værk og samme udbetalingsår hos andre organisationer. Du skal straks oplyse DFKS, hvis du har søgt, er blevet registreret til eller har modtaget en sådan dobbelt udbetaling.\n\nDu skal beskytte din konto og straks kontakte organisationen ved mistanke om misbrug. Vilkår versioneres. En ny publiceret version skal accepteres ved næste login.'::text as body
  from public.organisations organisation
  cross join (values ('member'), ('non_member')) audience(name)
)
insert into public.legal_document_versions (
  org_id, document_type, audience, title, body, content_hash, version, status, created_at, updated_at
)
select proposed.org_id,
       'terms_of_service',
       proposed.audience,
       'Brugervilkår for Portalen',
       proposed.body,
       encode(digest(proposed.body, 'sha256'), 'hex'),
       coalesce((select max(existing.version) + 1 from public.legal_document_versions existing where existing.org_id = proposed.org_id and existing.document_type = 'terms_of_service' and existing.audience = proposed.audience), 1),
       'draft',
       now(),
       now()
from proposed_terms proposed
where not exists (
  select 1 from public.legal_document_versions draft
  where draft.org_id = proposed.org_id
    and draft.document_type = 'terms_of_service'
    and draft.audience = proposed.audience
    and draft.status = 'draft'
);
