alter table public.rettighedshavere
  add column if not exists portrait_url text;

comment on column public.rettighedshavere.portrait_url is
  'Valgt portræt/avatar for rettighedshaveren, enten fra ekstern kilde eller uploadet af brugeren.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatarer kan laeses af loggede brugere" on storage.objects;
create policy "Avatarer kan laeses af loggede brugere"
on storage.objects
for select
to authenticated
using (bucket_id = 'avatars');

drop policy if exists "Brugere kan uploade egne avatarer" on storage.objects;
create policy "Brugere kan uploade egne avatarer"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Brugere kan opdatere egne avatarer" on storage.objects;
create policy "Brugere kan opdatere egne avatarer"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
