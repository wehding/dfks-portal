-- Procentbaserede satser (royalty, tillæg, fondsbidrag) per overenskomst.
-- Bruges som struktureret kontekst i kontraktgennemgangen — ikke automatisk beregning.

create table if not exists public.agreement_percentage_rules (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  rate_key text not null,
  label text not null,
  percent numeric(6,2) not null,
  basis text not null,
  trigger_condition text not null,
  category text not null,
  profession_role text,
  employment_form text,
  section_reference text,
  source_title text,
  source_url text,
  source_checked_at date,
  source_note text,
  valid_from date not null,
  valid_to date,
  status text not null default 'draft',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agreement_percentage_rules_employment_form_check
    check (employment_form is null or employment_form in ('a-løn', 'lønmodtager-freelance')),
  constraint agreement_percentage_rules_status_check
    check (status in ('draft', 'approved', 'archived')),
  constraint agreement_percentage_rules_dates_check
    check (valid_to is null or valid_to >= valid_from),
  constraint agreement_percentage_rules_percent_check
    check (percent >= 0),
  unique (agreement_id, rate_key, valid_from)
);

create index if not exists agreement_percentage_rules_lookup_idx
  on public.agreement_percentage_rules(agreement_id, category, valid_from desc)
  where status = 'approved';

alter table public.agreement_percentage_rules enable row level security;

drop policy if exists "Staff kan se procentregler" on public.agreement_percentage_rules;
create policy "Staff kan se procentregler"
  on public.agreement_percentage_rules for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist','viewer']));

drop policy if exists "Jurist og superadmin kan oprette procentregler" on public.agreement_percentage_rules;
create policy "Jurist og superadmin kan oprette procentregler"
  on public.agreement_percentage_rules for insert to authenticated
  with check (public.current_user_has_any_role(array['superadmin','jurist','admin']));

drop policy if exists "Jurist og superadmin kan opdatere procentregler" on public.agreement_percentage_rules;
create policy "Jurist og superadmin kan opdatere procentregler"
  on public.agreement_percentage_rules for update to authenticated
  using (public.current_user_has_any_role(array['superadmin','jurist','admin']))
  with check (public.current_user_has_any_role(array['superadmin','jurist','admin']));

drop policy if exists "Jurist og superadmin kan slette procentregler" on public.agreement_percentage_rules;
create policy "Jurist og superadmin kan slette procentregler"
  on public.agreement_percentage_rules for delete to authenticated
  using (public.current_user_has_any_role(array['superadmin','jurist','admin']));

revoke all on public.agreement_percentage_rules from anon;
grant select on public.agreement_percentage_rules to authenticated;
grant all on public.agreement_percentage_rules to service_role;
