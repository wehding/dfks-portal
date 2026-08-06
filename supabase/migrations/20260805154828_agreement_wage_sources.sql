-- Strukturerede loenkilder til AI-kontrolrummet og kontraktgennemgangen.
-- En sats er kun "approved", naar den kan dokumenteres i en officiel,
-- aktuelt publiceret kilde. Historiske skemaer bevares som review-noter og
-- maa ikke anvendes af AI som en aktuel minimumssats.

create table if not exists public.agreement_wage_rules (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  rate_key text not null,
  profession_role text not null,
  wage_group text,
  employment_form text not null default 'a-løn',
  rate_kind text not null default 'minimum',
  amount numeric(12,2),
  currency text not null default 'DKK',
  unit text,
  pension_included boolean not null default false,
  valid_from date not null,
  valid_to date,
  source_title text not null,
  source_url text not null,
  source_section text,
  source_checked_at date not null,
  source_note text,
  status text not null default 'draft',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agreement_wage_rules_employment_form_check
    check (employment_form in ('a-løn', 'lønmodtager-freelance')),
  constraint agreement_wage_rules_rate_kind_check
    check (rate_kind in ('minimum', 'normalløn', 'source_requires_review', 'individual_or_classified')),
  constraint agreement_wage_rules_amount_check
    check (
      (rate_kind in ('minimum', 'normalløn') and amount is not null and amount >= 0 and unit is not null)
      or (rate_kind in ('source_requires_review', 'individual_or_classified') and amount is null)
    ),
  constraint agreement_wage_rules_currency_check check (currency = 'DKK'),
  constraint agreement_wage_rules_unit_check check (unit is null or unit in ('time', 'dag', 'uge', 'måned')),
  constraint agreement_wage_rules_status_check check (status in ('draft', 'approved', 'archived')),
  constraint agreement_wage_rules_dates_check check (valid_to is null or valid_to >= valid_from),
  unique (agreement_id, rate_key, valid_from)
);

create index if not exists agreement_wage_rules_lookup_idx
  on public.agreement_wage_rules(agreement_id, profession_role, valid_from desc, valid_to)
  where status = 'approved';

alter table public.agreement_wage_rules enable row level security;

drop policy if exists "Staff kan se lønregler" on public.agreement_wage_rules;
create policy "Staff kan se lønregler"
  on public.agreement_wage_rules for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist','viewer']));

drop policy if exists "Jurist og superadmin kan oprette lønregler" on public.agreement_wage_rules;
create policy "Jurist og superadmin kan oprette lønregler"
  on public.agreement_wage_rules for insert to authenticated
  with check (public.current_user_has_any_role(array['superadmin','jurist']));

drop policy if exists "Jurist og superadmin kan opdatere lønregler" on public.agreement_wage_rules;
create policy "Jurist og superadmin kan opdatere lønregler"
  on public.agreement_wage_rules for update to authenticated
  using (public.current_user_has_any_role(array['superadmin','jurist']))
  with check (public.current_user_has_any_role(array['superadmin','jurist']));

drop policy if exists "Jurist og superadmin kan slette lønregler" on public.agreement_wage_rules;
create policy "Jurist og superadmin kan slette lønregler"
  on public.agreement_wage_rules for delete to authenticated
  using (public.current_user_has_any_role(array['superadmin','jurist']));

revoke all on public.agreement_wage_rules from anon;
grant select on public.agreement_wage_rules to authenticated;
grant all on public.agreement_wage_rules to service_role;

insert into public.agreement_wage_rules
  (agreement_id, rate_key, profession_role, wage_group, employment_form, rate_kind,
   amount, unit, pension_included, valid_from, valid_to, source_title, source_url,
   source_section, source_checked_at, source_note, status, approved_at)
select a.id, r.rate_key, r.profession_role, r.wage_group, r.employment_form, r.rate_kind,
       r.amount, r.unit, r.pension_included, r.valid_from, r.valid_to, r.source_title,
       r.source_url, r.source_section, r.source_checked_at, r.source_note, r.status,
       case when r.status = 'approved' then now() else null end
from public.agreements a
join (values
  (
    'de4-fiction-2022', 'editor-group-2-2022', 'Klipper', 'Løngruppe 2', 'a-løn',
    'normalløn', 14637::numeric, 'uge', false, '2022-02-07'::date, null::date,
    'Lønoversigt De4 2022',
    'https://pro-f.dk/sites/default/files/2022-03/L%C3%B8noversigt%20De4%202022.pdf',
    'Bilag 2 · Løngruppe 2', '2026-08-05'::date,
    'Producentforeningen oplyser, at 2022-niveauet fortsat er udgangspunktet, indtil en ny aftale indgås. Pension lægges oven i satsen.',
    'approved'
  ),
  (
    'faf-fiction-2025', 'experienced-editor-assistant-2026', 'Erfaren klipperassistent', 'Løngruppe 7', 'a-løn',
    'normalløn', 8873, 'uge', false, '2026-01-01', '2026-12-31',
    'Løngrupper fiktionsoverenskomst FAF/Producentforeningen 2025-2027',
    'https://pro-f.dk/sites/default/files/2025-03/L%C3%B8ngrupper%20fiktionsoverenskomst%20FAF%20Producentforeningen%202025-27.pdf',
    'Bilag 2 · Normallønninger 2026 · Løngruppe 7', '2026-08-05',
    'Gælder dækkede klipperassistentfunktioner. Pension og BETA fremgår særskilt og er ikke medregnet i beløbet.',
    'approved'
  ),
  (
    'faf-fiction-2025', 'inexperienced-editor-assistant-2026', 'Uerfaren klipperassistent', 'Løngruppe 8', 'a-løn',
    'normalløn', 7817, 'uge', false, '2026-01-01', '2026-12-31',
    'Løngrupper fiktionsoverenskomst FAF/Producentforeningen 2025-2027',
    'https://pro-f.dk/sites/default/files/2025-03/L%C3%B8ngrupper%20fiktionsoverenskomst%20FAF%20Producentforeningen%202025-27.pdf',
    'Bilag 2 · Normallønninger 2026 · Løngruppe 8', '2026-08-05',
    'Grundsats før eventuel indslusningsreduktion. Pension og BETA fremgår særskilt og er ikke medregnet i beløbet.',
    'approved'
  ),
  (
    'dj-tv-2024', 'editor-group-2-2025', 'Redigering/klipper med selvstændigt ansvar', 'Gruppe 2', 'a-løn',
    'minimum', 28500, 'måned', false, '2025-04-01', null,
    'Løngrupper – tv-overenskomst DJ/Producentforeningen',
    'https://pro-f.dk/sites/default/files/2024-06/L%C3%B8ngrupper%20-%20tv-overenskomst%20DJ%20Producentforeningen_0.pdf',
    'Bilag 1 · Gruppe 2 samt tillæg pr. 1. april 2025', '2026-08-05',
    'Grundløn 28.000 kr. i lønskemaet plus det offentliggjorte generelle tillæg på 500 kr. fra 1. april 2025. Pension lægges oven i satsen.',
    'approved'
  ),
  (
    'faf-documentary', 'published-schedule-needs-review', 'Klipper og klipperassistent', null, 'a-løn',
    'source_requires_review', null, null, false, '2000-04-01', null,
    'Kort- og dokumentarfilm – offentlig overenskomstside og lønskema',
    'https://pro-f.dk/overenskomst/kort-og-dokumentarfilmoverenskomst-faf',
    'Officielt lønskema', '2026-08-05',
    'Overenskomsten oplyses fortsat gældende, men det offentliggjorte lønskema mangler en tydelig aktuel satsdato. Brug ikke et beløb automatisk før juridisk kontrol.',
    'draft'
  ),
  (
    'faf-tv-employee-2008', 'published-schedule-needs-review', 'Redigering/klipper', null, 'a-løn',
    'source_requires_review', null, null, false, '2008-01-01', null,
    'TV-overenskomst for ansatte – lønskema',
    'https://pro-f.dk/sites/default/files/2021-08/TV_FAF_DJ_Ansatte_L%C3%B8nskema.pdf',
    'Officielt publiceret lønskema', '2026-08-05',
    'Det linkede skema viser 2008-2009-satser. Det dokumenterer ikke alene en aktuel 2026-minimumsløn.',
    'draft'
  ),
  (
    'faf-tv-freelance-2008', 'published-schedule-needs-review', 'Redigering/klipper', null, 'lønmodtager-freelance',
    'source_requires_review', null, null, false, '2009-01-01', null,
    'TV-overenskomst for freelancere – lønskema',
    'https://pro-f.dk/sites/default/files/2023-10/DJ%3AFAF%20Freelance%20l%C3%B8nskema.pdf',
    'Officielt publiceret lønskema', '2026-08-05',
    'Skemaet angiver udtrykkeligt, at lønningerne ikke er ændret siden 2009. Satsen må ikke kaldes aktuel uden juridisk bekræftelse.',
    'draft'
  ),
  (
    'dr-metal-2025', 'classification-dependent-pay', 'Klipper/redigering', null, 'a-løn',
    'individual_or_classified', null, null, false, '2025-06-01', '2028-05-31',
    'Overenskomst mellem DR og Dansk Metal 2025-2028',
    'https://dansk-metal.euwest01.umbraco.io/media/arkhumoy/ok25-protokollat-dr-2025-2028.pdf',
    'Løn- og klassifikationsbestemmelser', '2026-08-05',
    'Der er ikke registreret én offentligt verificeret minimumssats specifikt for klippere. Kontrollér stillingsindplacering og eventuelle lokale/personlige løndele.',
    'draft'
  )
) as r(code, rate_key, profession_role, wage_group, employment_form, rate_kind,
       amount, unit, pension_included, valid_from, valid_to, source_title, source_url,
       source_section, source_checked_at, source_note, status)
  on a.code = r.code
on conflict (agreement_id, rate_key, valid_from) do update set
  profession_role = excluded.profession_role,
  wage_group = excluded.wage_group,
  employment_form = excluded.employment_form,
  rate_kind = excluded.rate_kind,
  amount = excluded.amount,
  unit = excluded.unit,
  pension_included = excluded.pension_included,
  valid_to = excluded.valid_to,
  source_title = excluded.source_title,
  source_url = excluded.source_url,
  source_section = excluded.source_section,
  source_checked_at = excluded.source_checked_at,
  source_note = excluded.source_note,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();
