create table if not exists public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  document_type text not null,
  audience text not null,
  version integer not null,
  status text not null default 'draft',
  title text not null,
  body text not null,
  content_hash text not null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_document_versions_type_check check (document_type in (
    'privacy_notice',
    'terms_of_service',
    'ai_transparency_notice',
    'contract_analysis_notice'
  )),
  constraint legal_document_versions_audience_check check (audience in ('member','non_member')),
  constraint legal_document_versions_status_check check (status in ('draft','published')),
  constraint legal_document_versions_version_check check (version > 0),
  constraint legal_document_versions_publish_state_check check (
    (status = 'draft' and published_at is null)
    or (status = 'published' and published_at is not null)
  ),
  constraint legal_document_versions_org_doc_audience_version_key unique (org_id, document_type, audience, version)
);

create unique index if not exists legal_document_versions_one_draft
  on public.legal_document_versions(org_id, document_type, audience)
  where status = 'draft';

create index if not exists legal_document_versions_current_idx
  on public.legal_document_versions(org_id, audience, document_type, version desc)
  where status = 'published';

alter table public.legal_document_versions enable row level security;
revoke all on public.legal_document_versions from public, anon, authenticated;
grant all on public.legal_document_versions to service_role;

comment on table public.legal_document_versions is
  'Versionerede organisationsspecifikke privatlivs-, vilkaar- og AI-transparenstekster. Redigeres kun via server actions.';
comment on column public.legal_document_versions.audience is
  'member og non_member har separate tekster, fordi statistikgrundlag og rettighedsformaal er forskellige.';

create table if not exists public.legal_document_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_version_id uuid not null references public.legal_document_versions(id) on delete restrict,
  document_type text not null,
  audience text not null,
  content_hash text not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint legal_document_acceptances_type_check check (document_type in (
    'privacy_notice',
    'terms_of_service',
    'ai_transparency_notice',
    'contract_analysis_notice'
  )),
  constraint legal_document_acceptances_audience_check check (audience in ('member','non_member')),
  constraint legal_document_acceptances_version_once_key unique (
    org_id,
    rights_holder_id,
    document_type,
    audience,
    document_version_id
  )
);

create index if not exists legal_document_acceptances_holder_idx
  on public.legal_document_acceptances(org_id, rights_holder_id, accepted_at desc);

alter table public.legal_document_acceptances enable row level security;
revoke all on public.legal_document_acceptances from public, anon, authenticated;
grant all on public.legal_document_acceptances to service_role;

comment on table public.legal_document_acceptances is
  'Historik over aktive accepter af juridiske dokumentversioner. Gamle accepter slettes ikke ved ny version.';

alter table public.org_affiliations
  drop constraint if exists org_affiliations_statistics_participation_source_check;

alter table public.org_affiliations
  add constraint org_affiliations_statistics_participation_source_check
  check (
    statistics_participation_source is null
    or statistics_participation_source in (
      'member_default',
      'member_reenrollment',
      'onboarding_choice',
      'non_member_onboarding_choice',
      'profile_choice',
      'non_member_profile_choice',
      'admin_choice',
      'legacy_migration'
    )
  );

create or replace function public.require_legal_onboarding_for_audience(
  target_org_id uuid,
  target_audience text,
  required_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer := 0;
begin
  if target_org_id is null or target_audience not in ('member','non_member') then
    raise exception 'Invalid legal onboarding requirement target';
  end if;

  update public.rettighedshavere holder
  set onboarding_required_at = required_at,
      updated_at = now()
  where holder.user_id is not null
    and exists (
      select 1
      from public.org_affiliations affiliation
      where affiliation.rights_holder_id = holder.id
        and affiliation.org_id = target_org_id
        and affiliation.is_member = (target_audience = 'member')
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.require_legal_onboarding_for_audience(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.require_legal_onboarding_for_audience(uuid, text, timestamptz)
  to service_role;

with defaults(document_type, audience, title, body) as (
  values
  ('privacy_notice', 'member', 'Velkommen til DFKS portalen - Din data, dine rettigheder',
   'For at give dig den skarpeste raadgivning om din loen og dine rettigheder bruger vi AI til at scanne din kontrakt. Din sikkerhed kommer foerst.

Inden systemet laeser dokumentet, maskerer vi automatisk CPR-nummer og bankoplysninger. Kontrakten behandles i et lukket system, som ikke bruges til at traene offentlige AI-modeller.

Som medlem er du oplyst om, at foreningen bruger overordnede kontrakt- og loenoplysninger til anonymiseret statistikarbejde. Statistikken bruges kun samlet og under faste diskretionsgraenser.

Laes den fulde privatlivspolitik: https://danskfilmklipperselskab.dk/privatlivspolitik/'),
  ('terms_of_service', 'member', 'Brugervilkaar for Portalen',
   'Portalen leverer digital softwareinfrastruktur, der understoetter organisationens sagsbehandling og raadgivning. Platformen, herunder AI-baserede kontraktanalyse- og statistikvaerktoejer, leverer alene raadgivende og beslutningsstoettende analyser.

Portalen er ikke aftalepartner i dine ansaettelses-, freelance- eller ophavsretskontrakter. Alle raadgivningsafgoerelser, overenskomstvurderinger og juridiske skridt foretages og godkendes af organisationens sagsbehandlere.

AI-genererede udtraek er vejledende og skal altid verificeres mod det originale kildedokument foer endelig sagsafslutning eller underskrift.'),
  ('ai_transparency_notice', 'member', 'EU AI Act transparensdeklaration',
   'Kontraktanalysen er udarbejdet med stoette fra kunstig intelligens i form af en sprogmodel. AI-systemet gennemsoger teksten for specifikke klausuler, for eksempel loen, pension, buyout, AI-forbehold og overenskomstafvigelser.

Systemet foretager ingen automatiske afgoerelser. Fundne passager fremhaeves, saa du eller din faglige konsulent aktivt kan gennemgaa, verificere og godkende analysen.'),
  ('contract_analysis_notice', 'member', 'Kontraktanalyse og maskering',
   'Naar du uploader en kontrakt, udtraekker systemet tekst og maskerer CPR-nummer, bankoplysninger og andre oplagte personlige kontaktoplysninger, foer teksten sendes til AI-analyse.

Analysen bruges til at finde relevante kontraktpunkter og mulige risici. En faglig raadgiver eller administrator skal kunne verificere fundene, foer de bruges som grundlag for raadgivning.'),
  ('privacy_notice', 'non_member', 'Tjek din kontrakt og sikr dine rettigheder',
   'Vi scanner din kontrakt i vores lukkede system for at hjaelpe dig med at opdage skjulte faldgruber, for eksempel urimelige AI-traeningsklausuler eller manglende streaming-kreditering.

Da du ikke er medlem, opbevarer vi din kontrakt sikkert som juridisk dokumentation, saa vi kan varetage dine ophavsrettigheder og sikre udbetaling af dine Copydan- og streamingmidler.

Dit CPR-nummer og dine bankoplysninger maskeres automatisk, inden systemet analyserer dokumentet. Din kontrakt behandles i et lukket system og benyttes aldrig til at traene offentlige AI-modeller.

Laes den fulde privatlivspolitik for rettighedshavere: https://danskfilmklipperselskab.dk/privatlivspolitik/'),
  ('terms_of_service', 'non_member', 'Brugervilkaar for Portalen',
   'Portalen leverer digital softwareinfrastruktur, der understoetter organisationens rettighedsarbejde og raadgivning. Platformen, herunder AI-baserede kontraktanalyse- og statistikvaerktoejer, leverer alene raadgivende og beslutningsstoettende analyser.

Portalen er ikke aftalepartner i dine ansaettelses-, freelance- eller ophavsretskontrakter. Alle raadgivningsafgoerelser, overenskomstvurderinger og juridiske skridt foretages og godkendes af organisationens sagsbehandlere.

AI-genererede udtraek er vejledende og skal altid verificeres mod det originale kildedokument foer endelig sagsafslutning eller underskrift.'),
  ('ai_transparency_notice', 'non_member', 'EU AI Act transparensdeklaration',
   'Kontraktanalysen er udarbejdet med stoette fra kunstig intelligens i form af en sprogmodel. AI-systemet gennemsoger teksten for specifikke klausuler, for eksempel loen, pension, buyout, AI-forbehold og overenskomstafvigelser.

Systemet foretager ingen automatiske afgoerelser. Fundne passager fremhaeves, saa du eller en faglig konsulent aktivt kan gennemgaa, verificere og godkende analysen.'),
  ('contract_analysis_notice', 'non_member', 'Kontraktanalyse og anonym markedsstatistik',
   'Naar du uploader en kontrakt, udtraekker systemet tekst og maskerer CPR-nummer, bankoplysninger og andre oplagte personlige kontaktoplysninger, foer teksten sendes til AI-analyse.

Du kan frivilligt vaelge, om dine overordnede loen- og arbejdsvilkaar maa indgaa i anonymiseret markedsstatistik. Hvis du vaelger nej, bruges kontrakten kun som dokumentation for dine rettigheder og udbetalinger.')
)
insert into public.legal_document_versions (
  org_id,
  document_type,
  audience,
  version,
  status,
  title,
  body,
  content_hash,
  published_at
)
select
  organisation.id,
  defaults.document_type,
  defaults.audience,
  1,
  'published',
  defaults.title,
  defaults.body,
  encode(extensions.digest(defaults.body, 'sha256'), 'hex'),
  now()
from public.organisations organisation
cross join defaults
on conflict (org_id, document_type, audience, version) do nothing;
