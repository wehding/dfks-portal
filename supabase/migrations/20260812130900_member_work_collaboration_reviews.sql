create table public.member_work_collaboration_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'solo_confirmed', 'coeditors_reported', 'disputed')),
  work_share_case_id uuid references public.work_share_cases(id) on delete set null,
  known_coeditor_count_at_response integer not null default 0
    check (known_coeditor_count_at_response >= 0),
  source text not null default 'assignment'
    check (source in ('assignment', 'backfill', 'member_bulk', 'member_editor', 'coeditor_report', 'admin_resolution')),
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  dispute_note text,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, rights_holder_id, work_id)
);

create index member_work_collaboration_reviews_holder_status_idx
  on public.member_work_collaboration_reviews (rights_holder_id, status, updated_at desc);
create index member_work_collaboration_reviews_org_disputes_idx
  on public.member_work_collaboration_reviews (org_id, status, updated_at desc)
  where status = 'disputed';

comment on table public.member_work_collaboration_reviews is
  'Medlemmets obligatoriske gennemgang af, om et værk eller serieafsnit blev klippet alene eller med andre.';
comment on column public.member_work_collaboration_reviews.status is
  'solo_confirmed gemmer ikke automatisk en arbejdsandel på 100 procent; procenter offentliggøres kun gennem fordelingssager.';

alter table public.member_work_collaboration_reviews enable row level security;
revoke all on public.member_work_collaboration_reviews from public, anon, authenticated;
grant select on public.member_work_collaboration_reviews to authenticated;
grant all on public.member_work_collaboration_reviews to service_role;

create policy "Members read own collaboration reviews"
  on public.member_work_collaboration_reviews for select to authenticated
  using (public.current_user_is_member_owner(rights_holder_id));

create policy "Admins read organisation collaboration reviews"
  on public.member_work_collaboration_reviews for select to authenticated
  using (public.current_user_can_admin_org(org_id));

create or replace function private.sync_member_work_collaboration_review()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  assigned_work public.works%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.rights_holder_id is null then return new; end if;
    select * into assigned_work from public.works where id = new.work_id;
    if assigned_work.id is null then return new; end if;
    -- Serieforældre gennemgås ikke. Når afsnitsvalget opretter konkrete
    -- afsnitstilknytninger, får hvert afsnit sin egen pending-opgave.
    if assigned_work.parent_work_id is null
       and assigned_work.episode_number is null
       and position('serie' in lower(coalesce(assigned_work.type, ''))) > 0 then
      return new;
    end if;
    insert into public.member_work_collaboration_reviews (
      org_id, rights_holder_id, work_id, status, source
    ) values (
      new.org_id, new.rights_holder_id, new.work_id, 'pending', 'assignment'
    ) on conflict (org_id, rights_holder_id, work_id) do nothing;
    return new;
  end if;

  if old.rights_holder_id is not null and not exists (
    select 1 from public.work_assignments remaining
    where remaining.org_id = old.org_id
      and remaining.rights_holder_id = old.rights_holder_id
      and remaining.work_id = old.work_id
  ) then
    delete from public.member_work_collaboration_reviews review
    where review.org_id = old.org_id
      and review.rights_holder_id = old.rights_holder_id
      and review.work_id = old.work_id;
  end if;
  return old;
end;
$$;

revoke all on function private.sync_member_work_collaboration_review() from public, anon, authenticated;

create trigger sync_collaboration_review_after_assignment_insert
after insert on public.work_assignments
for each row execute function private.sync_member_work_collaboration_review();

create trigger sync_collaboration_review_after_assignment_delete
after delete on public.work_assignments
for each row execute function private.sync_member_work_collaboration_review();

insert into public.member_work_collaboration_reviews (
  org_id, rights_holder_id, work_id, status, source
)
select distinct assignment.org_id, assignment.rights_holder_id, assignment.work_id, 'pending', 'backfill'
from public.work_assignments assignment
join public.works work on work.id = assignment.work_id
where assignment.rights_holder_id is not null
  and not (
    work.parent_work_id is null
    and work.episode_number is null
    and position('serie' in lower(coalesce(work.type, ''))) > 0
  )
on conflict (org_id, rights_holder_id, work_id) do nothing;
