insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organisation-logos',
  'organisation-logos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Organisationslogoer kan laeses offentligt" on storage.objects;
create policy "Organisationslogoer kan laeses offentligt"
on storage.objects
for select
to public
using (bucket_id = 'organisation-logos');

comment on column public.organisations.logo_url is
  'Offentlig URL til organisationens logo, normalt i Storage-bucket organisation-logos.';
