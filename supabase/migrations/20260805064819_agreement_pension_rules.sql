-- Versionsstyret register over kollektive aftaler og pensionsregler.
-- Aftalerne er globale (org_id = null), men kan kun administreres af staff.

alter table public.agreements
  add column if not exists code text,
  add column if not exists parties text[] not null default '{}',
  add column if not exists production_types text[] not null default '{}',
  add column if not exists profession_roles text[] not null default '{}',
  add column if not exists employment_forms text[] not null default '{a-løn}',
  add column if not exists source_url text,
  add column if not exists source_hash text,
  add column if not exists status text not null default 'draft',
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists notes text;

alter table public.agreements drop constraint if exists agreements_status_check;
alter table public.agreements
  add constraint agreements_status_check check (status in ('draft', 'approved', 'archived'));

create unique index if not exists agreements_code_unique_idx
  on public.agreements(code) where code is not null;

-- Den gamle policy gav alle admins global skriveret til alle aftaler. Kun juridisk
-- godkendte roller må aktivere eller ændre de globale overenskomstregler.
drop policy if exists "Admins kan administrere overenskomster" on public.agreements;
drop policy if exists "Jurist og superadmin kan administrere overenskomster" on public.agreements;
create policy "Jurist og superadmin kan administrere overenskomster"
  on public.agreements for all to authenticated
  using (public.current_user_has_any_role(array['superadmin','jurist']))
  with check (public.current_user_has_any_role(array['superadmin','jurist']));

create table if not exists public.agreement_pension_rules (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  employment_form text not null default 'a-løn',
  employer_percent numeric(6,3) not null,
  employee_percent numeric(6,3) not null default 0,
  basis text not null,
  scheme_kind text not null default 'occupational_pension',
  valid_from date not null,
  valid_to date,
  section_reference text not null,
  source_note text,
  status text not null default 'draft',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agreement_pension_rules_employment_form_check
    check (employment_form in ('a-løn', 'lønmodtager-freelance')),
  constraint agreement_pension_rules_basis_check
    check (basis in ('normalløn', 'minimumsløn', 'grundløn', 'alle-løndele', 'honorar')),
  constraint agreement_pension_rules_scheme_kind_check
    check (scheme_kind in ('occupational_pension', 'pension_savings')),
  constraint agreement_pension_rules_status_check
    check (status in ('draft', 'approved', 'archived')),
  constraint agreement_pension_rules_percent_check
    check (employer_percent >= 0 and employer_percent <= 100 and employee_percent >= 0 and employee_percent <= 100),
  constraint agreement_pension_rules_dates_check
    check (valid_to is null or valid_to >= valid_from),
  unique (agreement_id, employment_form, valid_from)
);

create index if not exists agreement_pension_rules_lookup_idx
  on public.agreement_pension_rules(agreement_id, employment_form, valid_from desc, valid_to)
  where status = 'approved';

alter table public.agreement_pension_rules enable row level security;

drop policy if exists "Staff kan se pensionsregler" on public.agreement_pension_rules;
create policy "Staff kan se pensionsregler"
  on public.agreement_pension_rules for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist','viewer']));

drop policy if exists "Jurist og superadmin kan oprette pensionsregler" on public.agreement_pension_rules;
create policy "Jurist og superadmin kan oprette pensionsregler"
  on public.agreement_pension_rules for insert to authenticated
  with check (public.current_user_has_any_role(array['superadmin','jurist']));

drop policy if exists "Jurist og superadmin kan opdatere pensionsregler" on public.agreement_pension_rules;
create policy "Jurist og superadmin kan opdatere pensionsregler"
  on public.agreement_pension_rules for update to authenticated
  using (public.current_user_has_any_role(array['superadmin','jurist']))
  with check (public.current_user_has_any_role(array['superadmin','jurist']));

drop policy if exists "Jurist og superadmin kan slette pensionsregler" on public.agreement_pension_rules;
create policy "Jurist og superadmin kan slette pensionsregler"
  on public.agreement_pension_rules for delete to authenticated
  using (public.current_user_has_any_role(array['superadmin','jurist']));

revoke all on public.agreement_pension_rules from anon;
grant select on public.agreement_pension_rules to authenticated;
grant all on public.agreement_pension_rules to service_role;

-- De officielle kilder registreres uden at kopiere dokumentindholdet ind i migrationen.
insert into public.agreements
  (code, title, doc_type, content_url, source_url, is_primary, valid_from, valid_to, parties,
   production_types, profession_roles, employment_forms, status, approved_at, notes)
values
  ('de4-fiction-2022', 'De4 Fiktionsoverenskomst 2022', 'overenskomst',
   'https://pro-f.dk/sites/default/files/2022-02/De%204%20Fiktionsoverenskomst_0.pdf',
   'https://pro-f.dk/overenskomst/fiktionsoverenskomst-mellem-de4-og-producentforeningen', true,
   '2022-02-07', null, array['De4','Producentforeningen'], array['feature','tvSeries'],
   array['klipper','b-klipper','supplerende klipper'], array['a-løn'], 'approved', now(),
   'Gælder lønmodtagere. Leverandør/B2B er ikke dækket.'),
  ('faf-fiction-2025', 'FAF Fiktionsoverenskomst 2025-2027', 'overenskomst',
   'https://pro-f.dk/sites/default/files/2025-05/Fiktionsoverenskomst%20-%202025%20-%202027%20FINAL%20med%20underskrifter%20og%20tekniske%20tilpasninger.pdf',
   'https://pro-f.dk/overenskomst/fiktionsoverenskomst-mellem-faf-og-producentforeningen-2025-2027', true,
   '2025-03-03', '2027-12-31', array['FAF','Producentforeningen'], array['feature','tvSeries'],
   array['klipperassistent','uerfaren klippeassistent','logger','loader'], array['a-løn'], 'approved', now(),
   'Omfatter ikke klipperfunktionen; den ligger under De4.'),
  ('faf-documentary', 'FAF Kort- og dokumentarfilmoverenskomst', 'overenskomst',
   'https://pro-f.dk/sites/default/files/2021-08/Kort_og_dokumentarfilm_Filmarbejdere_overenskomst.pdf',
   'https://pro-f.dk/overenskomst/kort-og-dokumentarfilmoverenskomst-faf', true,
   '2000-04-01', null, array['FAF','Producentforeningen'], array['documentary','docSeries','short'],
   array['klipper','klipperassistent'], array['a-løn'], 'draft', null,
   'Grundtekst og lønskema har forskellig pensionshistorik. 7,6 %-reglen kræver juridisk godkendelse.'),
  ('dj-tv-2024', 'DJ TV-overenskomst 2024-2026', 'overenskomst',
   'https://pro-f.dk/sites/default/files/2024-06/Tv-overenskomst%20DJ%20Producentforeningen_0.pdf',
   'https://pro-f.dk/overenskomst/tv-overenskomst-mellem-dj-og-producentforeningen', true,
   '2024-06-01', null, array['Dansk Journalistforbund','Producentforeningen'], array['tvEntertainment','reality','docSeries'],
   array['redigering','klipper'], array['a-løn'], 'approved', now(), null),
  ('faf-tv-employee-2008', 'FAF/DJ TV-overenskomst for ansatte', 'overenskomst',
   'https://pro-f.dk/sites/default/files/2021-08/TV_FAF_DJ_Ansatte_Overenskomst.pdf',
   'https://pro-f.dk/overenskomst/tv-overenskomst-ansatte-faf', true,
   '2008-01-01', null, array['FAF','Dansk Journalistforbund','Producentforeningen'], array['tvEntertainment','reality','docSeries'],
   array['redigering','klipper'], array['a-løn'], 'approved', now(), null),
  ('faf-tv-freelance-2008', 'FAF/DJ TV-overenskomst for lønmodtagerfreelancere', 'overenskomst',
   'https://pro-f.dk/sites/default/files/2021-08/TV_FAF_DJ_Freelance_Overenskomst.pdf',
   'https://pro-f.dk/overenskomst/tv-overenskomst-freelancere-faf', true,
   '2008-01-01', null, array['FAF','Dansk Journalistforbund','Producentforeningen'], array['tvEntertainment','reality','docSeries'],
   array['redigering','klipper'], array['lønmodtager-freelance'], 'approved', now(),
   'Freelancer i aftalen er lønmodtager og ikke leverandør/B2B.'),
  ('dr-metal-2025', 'DR og Dansk Metal 2025-2028', 'overenskomst',
   'https://dansk-metal.euwest01.umbraco.io/media/arkhumoy/ok25-protokollat-dr-2025-2028.pdf',
   'https://www.danskmetal.dk/overenskomster', true,
   '2025-06-01', '2028-05-31', array['DR','Dansk Metal'], array['feature','tvSeries','documentary','docSeries','tvEntertainment','reality','other'],
   array['klipper','redigering'], array['a-løn','lønmodtager-freelance'], 'approved', now(),
   'Satserne afhænger af dato og af, om personen er fastansat eller lønmodtagerfreelancer.')
on conflict (code) where code is not null do update set
  title = excluded.title,
  content_url = excluded.content_url,
  source_url = excluded.source_url,
  valid_from = excluded.valid_from,
  valid_to = excluded.valid_to,
  parties = excluded.parties,
  production_types = excluded.production_types,
  profession_roles = excluded.profession_roles,
  employment_forms = excluded.employment_forms,
  notes = excluded.notes,
  updated_at = now();

insert into public.agreement_pension_rules
  (agreement_id, employment_form, employer_percent, employee_percent, basis, scheme_kind,
   valid_from, valid_to, section_reference, source_note, status, approved_at)
select a.id, r.employment_form, r.employer_percent, r.employee_percent, r.basis, r.scheme_kind,
       r.valid_from, r.valid_to, r.section_reference, r.source_note, r.status, r.approved_at
from public.agreements a
join (values
  ('de4-fiction-2022','a-løn',9.5::numeric,0::numeric,'normalløn','occupational_pension','2022-02-07'::date,null::date,'§ 3, stk. 4','Producenten betaler pension oven i normallønnen.','approved',now()),
  ('faf-fiction-2025','a-løn',9.5,0,'normalløn','occupational_pension','2025-03-03','2027-12-31','§ 3, stk. 4','Kun dækkede FAF-funktioner, herunder klippeassistenter.','approved',now()),
  ('faf-documentary','a-løn',7.6,0,'normalløn','occupational_pension','2006-01-01',null,'Officielt lønskema','Afventer juridisk bekræftelse af historisk gyldighed.','draft',null),
  ('dj-tv-2024','a-løn',10,0,'grundløn','occupational_pension','2024-06-01',null,'§ 5','Producenten indbetaler pensionsbidraget.','approved',now()),
  ('faf-tv-employee-2008','a-løn',9,0,'minimumsløn','occupational_pension','2008-01-01',null,'§ 4','Producenten indbetaler pensionsbidraget.','approved',now()),
  ('faf-tv-freelance-2008','lønmodtager-freelance',9,0.8,'normalløn','occupational_pension','2009-01-01',null,'§ 4','Arbejdsgiverbidrag 9 %, eget bidrag 0,8 %.','approved',now()),
  ('dr-metal-2025','a-løn',15,0,'alle-løndele','occupational_pension','2024-06-01','2027-05-31','§ 7 og OK25 pkt. 1.3','Undtager engangsvederlag og udbetaling fra Fritvalgs Lønkonto.','approved',now()),
  ('dr-metal-2025','a-løn',16,0,'alle-løndele','occupational_pension','2027-06-01','2028-05-31','OK25 pkt. 1.3','Pensionsbidraget hæves til 16 %.','approved',now()),
  ('dr-metal-2025','lønmodtager-freelance',4.7,0,'honorar','pension_savings','2026-01-01','2026-05-31','Bilag 12, § 3','DR-betalt pensionsopsparing.','approved',now()),
  ('dr-metal-2025','lønmodtager-freelance',7.2,0,'honorar','pension_savings','2026-06-01','2027-05-31','Bilag 12, § 3','DR-betalt pensionsopsparing.','approved',now()),
  ('dr-metal-2025','lønmodtager-freelance',9.4,0,'honorar','pension_savings','2027-06-01','2028-05-31','Bilag 12, § 3','DR-betalt pensionsopsparing.','approved',now())
) as r(code, employment_form, employer_percent, employee_percent, basis, scheme_kind,
       valid_from, valid_to, section_reference, source_note, status, approved_at)
  on a.code = r.code
on conflict (agreement_id, employment_form, valid_from) do update set
  employer_percent = excluded.employer_percent,
  employee_percent = excluded.employee_percent,
  basis = excluded.basis,
  scheme_kind = excluded.scheme_kind,
  valid_to = excluded.valid_to,
  section_reference = excluded.section_reference,
  source_note = excluded.source_note,
  updated_at = now();
