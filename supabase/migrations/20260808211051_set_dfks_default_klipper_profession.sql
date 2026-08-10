-- DFKS' nuværende rettighedshavere er klippere som udgangspunkt. Faggruppen
-- findes i fælles stamdata, men vælges kun via DFKS' organisationstilknytning.
update public.rettighedshavere as rights_holder
set primary_profession_type_id = default_profession.profession_type_id
from (
  select organisation.id as org_id, organisation_profession.profession_type_id
  from public.organisations as organisation
  join public.organisation_profession_types as organisation_profession
    on organisation_profession.org_id = organisation.id
  join public.profession_types as profession
    on profession.id = organisation_profession.profession_type_id
  where organisation.name = 'Dansk Filmklipperselskab'
    and profession.normalized_name = 'klipper'
  limit 1
) as default_profession
where exists (
  select 1
  from public.org_affiliations as affiliation
  where affiliation.rights_holder_id = rights_holder.id
    and affiliation.org_id = default_profession.org_id
);
