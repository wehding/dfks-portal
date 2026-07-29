create table if not exists public.profession_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored unique,
  created_at timestamptz not null default now()
);
create table if not exists public.producer_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored unique,
  created_at timestamptz not null default now()
);
create table if not exists public.organisation_profession_types (
  org_id uuid not null references public.organisations(id) on delete cascade,
  profession_type_id uuid not null references public.profession_types(id) on delete cascade,
  display_order integer not null default 0,
  primary key (org_id, profession_type_id)
);
create table if not exists public.organisation_producer_categories (
  org_id uuid not null references public.organisations(id) on delete cascade,
  producer_category_id uuid not null references public.producer_categories(id) on delete cascade,
  display_order integer not null default 0,
  primary key (org_id, producer_category_id)
);

alter table public.profession_types enable row level security;
alter table public.producer_categories enable row level security;
alter table public.organisation_profession_types enable row level security;
alter table public.organisation_producer_categories enable row level security;

create policy "Staff kan læse faggruppetyper" on public.profession_types
  for select to authenticated using (auth.uid() is not null);
create policy "Staff kan læse producenttyper" on public.producer_categories
  for select to authenticated using (auth.uid() is not null);
create policy "Staff kan læse organisationens faggrupper" on public.organisation_profession_types
  for select to authenticated using (public.current_user_can_admin_org(org_id));
create policy "Staff kan læse organisationens producenttyper" on public.organisation_producer_categories
  for select to authenticated using (public.current_user_can_admin_org(org_id));

revoke all on public.profession_types, public.producer_categories,
  public.organisation_profession_types, public.organisation_producer_categories
  from public, anon, authenticated;
grant select on public.profession_types, public.producer_categories,
  public.organisation_profession_types, public.organisation_producer_categories to authenticated;
grant all on public.profession_types, public.producer_categories,
  public.organisation_profession_types, public.organisation_producer_categories to service_role;

insert into public.profession_types(name)
select distinct value
from public.organisations,
     lateral jsonb_array_elements_text(coalesce(terminology->'role_labels', '[]'::jsonb)) value
where trim(value) <> ''
on conflict (normalized_name) do nothing;

insert into public.organisation_profession_types(org_id, profession_type_id, display_order)
select organisation.id, profession.id, source.ordinality::integer - 1
from public.organisations organisation
cross join lateral jsonb_array_elements_text(coalesce(organisation.terminology->'role_labels', '[]'::jsonb))
  with ordinality source(value, ordinality)
join public.profession_types profession on profession.normalized_name = lower(trim(source.value))
on conflict do nothing;
