alter table public.employer_legal_entities
  add column if not exists contact_phone text;

update public.employer_legal_entities entity
set contact_phone = employer.contact_phone
from public.employers employer
where entity.employer_id = employer.id
  and entity.is_primary
  and entity.contact_phone is null
  and employer.contact_phone is not null
  and trim(employer.contact_phone) <> '';

comment on column public.employer_legal_entities.contact_phone is
  'Contact phone for this specific legal registration; canonical producer identity remains on employers.';
