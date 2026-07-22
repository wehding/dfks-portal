create table public.message_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  created_by uuid not null references auth.users(id),
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.member_message_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  campaign_id uuid references public.message_campaigns(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index member_message_threads_campaign_recipient_uidx
  on public.member_message_threads (campaign_id, rights_holder_id) where campaign_id is not null;
create index member_message_threads_member_updated_idx
  on public.member_message_threads (rights_holder_id, updated_at desc);

create table public.member_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.member_message_threads(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('member', 'admin')),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index member_messages_thread_created_idx on public.member_messages (thread_id, created_at);

create table public.member_message_participants (
  thread_id uuid not null references public.member_message_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);

alter table public.message_campaigns enable row level security;
alter table public.member_message_threads enable row level security;
alter table public.member_messages enable row level security;
alter table public.member_message_participants enable row level security;

create policy "Orgadmins kan se kampagner" on public.message_campaigns for select to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));
create policy "Deltagere kan se beskedtråde" on public.member_message_threads for select to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']) or exists (
    select 1 from public.rettighedshavere rh
    join public.org_affiliations affiliation on affiliation.rights_holder_id = rh.id and affiliation.org_id = member_message_threads.org_id
    where rh.id = rights_holder_id and rh.user_id = (select auth.uid())
  ));
create policy "Deltagere kan se beskeder" on public.member_messages for select to authenticated
  using (exists (select 1 from public.member_message_threads t where t.id = thread_id and (
    public.current_user_has_org_role(t.org_id, array['superadmin','admin','org-admin']) or exists (
      select 1 from public.rettighedshavere rh
      join public.org_affiliations affiliation on affiliation.rights_holder_id = rh.id and affiliation.org_id = t.org_id
      where rh.id = t.rights_holder_id and rh.user_id = (select auth.uid())
    )
  )));
create policy "Brugere kan se egen læsestatus" on public.member_message_participants for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.message_campaigns, public.member_message_threads, public.member_messages, public.member_message_participants to authenticated;
grant all on public.message_campaigns, public.member_message_threads, public.member_messages, public.member_message_participants to service_role;
