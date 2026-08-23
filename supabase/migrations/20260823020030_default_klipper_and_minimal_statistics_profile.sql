-- Sæt Klipper som primær faggruppe for eksisterende medlemmer i organisationer,
-- hvor faggruppen allerede findes i organisationens egen opsætning.
-- Dette ændrer ikke organisationstilknytninger og gør ikke DFKS til standard for
-- brugere uden en eksisterende organisationstilknytning.
with default_klipper_profession as (
  select organisation_profession.org_id, organisation_profession.profession_type_id
  from public.organisation_profession_types as organisation_profession
  join public.profession_types as profession
    on profession.id = organisation_profession.profession_type_id
  where lower(profession.normalized_name) in ('klipper', 'klippet')
)
update public.rettighedshavere as rights_holder
set primary_profession_type_id = default_profession.profession_type_id
from public.org_affiliations as affiliation
join default_klipper_profession as default_profession
  on default_profession.org_id = affiliation.org_id
where affiliation.rights_holder_id = rights_holder.id
  and rights_holder.primary_profession_type_id is null;

-- Yderligere faggrupper fjernes fra opsætning/onboarding, fordi rolle/faglig
-- funktion håndteres på det enkelte værk. Typisk arbejdsform gøres synlig og
-- valgfri i minimumsvisningen.
update public.organisations
set statistics_profile_config =
  coalesce(statistics_profile_config, '{}'::jsonb)
  || jsonb_build_object(
    'secondary_profession_types', false,
    'usual_work_mode', true
  );
